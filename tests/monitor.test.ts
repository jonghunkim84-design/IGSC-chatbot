/** 운영 모니터링: 상태 판정, 알림 중복 방지·전송 */
import { describe, expect, it, vi } from "vitest";
import { evaluate, overall, type Signals } from "@/lib/monitor/evaluate";
import { formatAlert, sendAlerts } from "@/lib/monitor/alert";
import type { HitFn } from "@/lib/rate-limit";

const healthy: Signals = {
  dbOk: true,
  aiOk: true,
  lastHour: { total: 20, errors: 0 },
  daily: { used: 100, cap: 3000 },
  approvedFaq: 400,
  openUnanswered: 5,
};
const codes = (s: Partial<Signals>) => evaluate({ ...healthy, ...s }).map((i) => i.code);

describe("evaluate", () => {
  it("모두 정상이면 문제 없음", () => {
    expect(evaluate(healthy)).toEqual([]);
    expect(overall([])).toBe("ok");
  });
  it("AI 실패는 긴급 (크레딧 소진 사고)", () => {
    const issues = evaluate({ ...healthy, aiOk: false, aiError: "credit balance is too low" });
    expect(issues.map((i) => i.code)).toEqual(["ai-down"]);
    expect(issues[0].message).toContain("credit balance");
    expect(overall(issues)).toBe("critical");
  });
  it("DB 실패면 DB 이외 지표는 판단하지 않는다", () => {
    expect(codes({ dbOk: false, approvedFaq: 0, openUnanswered: 99 })).toEqual(["db-down"]);
  });
  it("오류 이관: 3건 이상이고 20% 이상일 때만", () => {
    expect(codes({ lastHour: { total: 20, errors: 2 } })).toEqual([]);
    expect(codes({ lastHour: { total: 100, errors: 5 } })).toEqual([]); // 5%
    expect(codes({ lastHour: { total: 10, errors: 4 } })).toEqual(["chat-errors"]);
  });
  it("하루 상한: 80% 주의, 도달하면 긴급", () => {
    expect(codes({ daily: { used: 2400, cap: 3000 } })).toEqual(["daily-near"]);
    expect(codes({ daily: { used: 3000, cap: 3000 } })).toEqual(["daily-cap"]);
  });
  it("승인 FAQ 0건·미답변 적체는 주의", () => {
    const issues = evaluate({ ...healthy, approvedFaq: 0, openUnanswered: 30 });
    expect(issues.map((i) => i.code)).toEqual(["no-approved-faq", "unanswered-backlog"]);
    expect(overall(issues)).toBe("warning");
  });
});

const memHit = (): HitFn => {
  const seen = new Map<string, number>();
  return async (key, _w, limit) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { allowed: n <= limit, retryAfter: 1 };
  };
};

describe("sendAlerts", () => {
  const ai = evaluate({ ...healthy, aiOk: false });

  it("웹훅으로 전송하고, 같은 문제는 쿨다운 동안 다시 보내지 않는다", async () => {
    const hit = memHit();
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    const first = await sendAlerts(ai, { webhookUrl: "https://hook.test/x", hit, fetchFn });
    expect(first.sent).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.text).toContain("AI 호출이 실패");

    const second = await sendAlerts(ai, { webhookUrl: "https://hook.test/x", hit, fetchFn });
    expect(second.sent).toHaveLength(0);
    expect(second.suppressed).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("새로 생긴 다른 문제는 보낸다", async () => {
    const hit = memHit();
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    await sendAlerts(ai, { webhookUrl: "https://hook.test/x", hit, fetchFn });
    const both = evaluate({ ...healthy, aiOk: false, daily: { used: 3000, cap: 3000 } });
    const r = await sendAlerts(both, { webhookUrl: "https://hook.test/x", hit, fetchFn });
    expect(r.sent.map((i) => i.code)).toEqual(["daily-cap"]);
    expect(r.suppressed.map((i) => i.code)).toEqual(["ai-down"]);
  });
  it("웹훅이 없으면 로그에만 남기고 보내지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn();
    const r = await sendAlerts(ai, { webhookUrl: "", hit: memHit(), fetchFn });
    expect(r.logOnly).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("전송 실패는 삼키지 않고 throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendAlerts(ai, { webhookUrl: "https://hook.test/x", hit: memHit(), fetchFn: async () => ({ ok: false, status: 500 }) })).rejects.toThrow("HTTP 500");
    spy.mockRestore();
  });
  it("관리자 이메일로 전송한다 (Resend, 수신자는 관리자 목록)", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
    const r = await sendAlerts(ai, { resendKey: "re_test", emailTo: ["a@x.test", "b@x.test"], webhookUrl: "", hit: memHit(), fetchFn });
    expect(r.channels).toEqual(["email"]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["a@x.test", "b@x.test"]);
    expect(body.subject).toContain("긴급");
  });
  it("이메일 키가 없으면 이메일 채널은 쓰지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendAlerts(ai, { resendKey: "", emailTo: ["a@x.test"], webhookUrl: "", hit: memHit(), fetchFn: vi.fn() });
    expect(r.logOnly).toBe(true);
    spy.mockRestore();
  });
  it("한 채널이 실패해도 다른 채널은 보낸다 (모두 실패해야 throw)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn(async (url: string) => (url.includes("resend") ? { ok: false, status: 403 } : { ok: true, status: 200 }));
    const r = await sendAlerts(ai, { resendKey: "k", emailTo: ["a@x.test"], webhookUrl: "https://hook.test/x", hit: memHit(), fetchFn });
    expect(r.sent).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("메시지에 상태 화면 주소가 붙는다", () => {
    expect(formatAlert(ai, "https://x.test")).toContain("https://x.test/admin/status");
  });
});
