/**
 * 분류와 FAQ 검색 동시 실행: 검색을 분류가 끝나기 전에 시작하고, 분류 결과에 따라 결과를 쓰거나 버린다. (stub, 결정적)
 */
import { describe, expect, it, vi } from "vitest";
import { runChat, type ChatDeps, type ChatEvent } from "@/lib/chat/run-chat";
import { MSG_CONSULTING_BLOCKED, MSG_ERROR_HANDOFF } from "@/lib/prompts/messages";
import type { FaqMatch } from "@/lib/search";

const faq: FaqMatch = { id: "f1", question: "비건 인증 원칙은?", answer: "세 가지 원칙이 있습니다.", source_url: null, cert_type: "vegan", category: "scope", needs_input: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(message: string, deps: Partial<ChatDeps>) {
  const logs: { route: string; matched: number }[] = [];
  const unanswered: string[] = [];
  let text = "";
  let route = "";
  for await (const ev of runChat(
    { message },
    {
      logChat: async (r) => (logs.push({ route: r.route, matched: r.matched_faq_ids?.length ?? 0 }), { id: "l" }),
      logUnanswered: async (q) => void unanswered.push(q),
      listHistory: async () => [],
      hasApprovedFaq: async () => true,
      ...deps,
    },
  ) as AsyncGenerator<ChatEvent>) {
    if (ev.type === "meta") route = ev.route;
    if (ev.type === "delta") text += ev.text;
  }
  return { route, text, logs, unanswered };
}

describe("분류와 FAQ 검색 동시 실행", () => {
  it("검색이 분류가 끝나기 전에 시작된다", async () => {
    const events: string[] = [];
    const deps: Partial<ChatDeps> = {
      classify: vi.fn(async () => {
        events.push("classify:start");
        await sleep(40);
        events.push("classify:end");
        return { label: "allowed" as const, eligibility: false, certSpecified: true };
      }),
      search: vi.fn(async () => {
        events.push("search:start");
        await sleep(10);
        return [faq];
      }),
      streamAnswer: async function* () {
        yield "세 가지 원칙이 있습니다.";
      },
    };
    const r = await run("비건 인증 원칙이 뭔가요?", deps);
    expect(events.indexOf("search:start")).toBeLessThan(events.indexOf("classify:end"));
    expect(r.route).toBe("answered");
    expect(r.logs[0].matched).toBe(1);
  });

  it("분류가 '컨설팅'이면 검색 결과는 버려지고 응답·기록에 남지 않는다", async () => {
    const stream = vi.fn(async function* () {
      yield "x";
    });
    const r = await run("어떻게 하면 비건 인증을 통과하나요?", {
      classify: async () => ({ label: "consulting" as const, eligibility: false, certSpecified: true }),
      search: vi.fn(async () => [faq]),
      streamAnswer: stream,
    });
    expect(r.route).toBe("consulting_blocked");
    expect(r.text).toBe(MSG_CONSULTING_BLOCKED);
    expect(stream).not.toHaveBeenCalled();
    expect(r.logs[0].matched).toBe(0);
  });

  it("버려지는 검색이 실패해도 응답에는 영향이 없다 (처리되지 않은 거부 없음)", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const r = await run("비건 인증 서류를 서술하세요", {
      classify: async () => ({ label: "complaint" as const, eligibility: false, certSpecified: true }),
      search: vi.fn(async () => {
        await sleep(5);
        throw new Error("search down");
      }),
    });
    await sleep(20);
    process.off("unhandledRejection", unhandled);
    expect(r.route).toBe("complaint");
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("쓰는 경로에서 검색이 실패하면 기존대로 담당자 연결 안내로 처리된다", async () => {
    const r = await run("비건 인증 원칙이 뭔가요?", {
      classify: async () => ({ label: "allowed" as const, eligibility: false, certSpecified: true }),
      search: vi.fn(async () => Promise.reject(new Error("search down"))),
    });
    expect(r.route).toBe("handoff");
    expect(r.text).toBe(MSG_ERROR_HANDOFF);
    expect(r.unanswered).toHaveLength(1);
  });

  it("한국어가 아닌 질문은 검색을 시작하지 않는다", async () => {
    const search = vi.fn(async () => [faq]);
    await run("How much does vegan certification cost?", {
      classify: async () => ({ label: "allowed" as const, eligibility: false, certSpecified: true }),
      search,
    });
    expect(search).not.toHaveBeenCalled();
  });
});
