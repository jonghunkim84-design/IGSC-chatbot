/** 요청 제한: 규칙 순서, 저장소 오류 시 메모리 대체, IP 추출, 키 해시 */
import { describe, expect, it, vi } from "vitest";
import { chatRules, checkRateLimit, getClientIp, hashSubject, loginRules, memoryHit, type HitFn } from "@/lib/rate-limit";

const counterHit = (): { hit: HitFn; keys: string[] } => {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    hit: async (key, _w, limit) => {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { allowed: n <= limit, retryAfter: 30 };
    },
  };
};

describe("checkRateLimit", () => {
  it("한도까지 허용하고 넘으면 거부 + 재시도 시간", async () => {
    const { hit } = counterHit();
    const rules = [{ name: "t", subject: "1.1.1.1", windowSeconds: 60, limit: 2 }];
    expect((await checkRateLimit(rules, hit)).allowed).toBe(true);
    expect((await checkRateLimit(rules, hit)).allowed).toBe(true);
    const r = await checkRateLimit(rules, hit);
    expect(r).toEqual({ allowed: false, retryAfter: 30, rule: "t" });
  });
  it("대상이 다르면 따로 센다", async () => {
    const { hit } = counterHit();
    const mk = (s: string) => [{ name: "t", subject: s, windowSeconds: 60, limit: 1 }];
    expect((await checkRateLimit(mk("a"), hit)).allowed).toBe(true);
    expect((await checkRateLimit(mk("b"), hit)).allowed).toBe(true);
    expect((await checkRateLimit(mk("a"), hit)).allowed).toBe(false);
  });
  it("앞 규칙에서 거부되면 뒤 규칙은 세지 않는다", async () => {
    const { hit, keys } = counterHit();
    const rules = [
      { name: "first", subject: "x", windowSeconds: 60, limit: 0 },
      { name: "second", windowSeconds: 60, limit: 10 },
    ];
    const r = await checkRateLimit(rules, hit);
    expect(r.rule).toBe("first");
    expect(keys).toHaveLength(1);
  });
  it("저장소가 실패하면 로깅하고 메모리 제한으로 계속한다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad: HitFn = async () => {
      throw new Error("db down");
    };
    const rules = [{ name: "fallback-test", subject: "z", windowSeconds: 60, limit: 2 }];
    expect((await checkRateLimit(rules, bad)).allowed).toBe(true);
    expect((await checkRateLimit(rules, bad)).allowed).toBe(true);
    expect((await checkRateLimit(rules, bad)).allowed).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("저장 키에 원본 IP·이메일이 들어가지 않는다", async () => {
    const { hit, keys } = counterHit();
    await checkRateLimit(loginRules("9.9.9.9", "admin@example.com"), hit);
    expect(keys.join()).not.toContain("9.9.9.9");
    expect(keys.join()).not.toContain("admin@example.com");
    expect(hashSubject("a")).toBe(hashSubject("a"));
    expect(hashSubject("a")).not.toBe(hashSubject("b"));
  });
});

describe("memoryHit", () => {
  it("구간이 바뀌면 카운터가 초기화된다", () => {
    const t = 1_000_000_000_000;
    expect(memoryHit("w", 60, 1, t).allowed).toBe(true);
    expect(memoryHit("w", 60, 1, t + 1000).allowed).toBe(false);
    expect(memoryHit("w", 60, 1, t + 61_000).allowed).toBe(true);
  });
});

describe("getClientIp / 규칙", () => {
  it("x-forwarded-for 의 첫 주소, 없으면 x-real-ip", () => {
    expect(getClientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }))).toBe("1.2.3.4");
    expect(getClientIp(new Request("http://x", { headers: { "x-real-ip": "7.7.7.7" } }))).toBe("7.7.7.7");
    expect(getClientIp(new Request("http://x"))).toBe("unknown");
  });
  it("채팅 규칙은 IP 분당·시간당 + 전체 하루 상한", () => {
    expect(chatRules("1.1.1.1").map((r) => r.name)).toEqual(["chat-min", "chat-hour", "chat-day-all"]);
  });
});
