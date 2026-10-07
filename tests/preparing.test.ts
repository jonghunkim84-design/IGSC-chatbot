/** 승인된 FAQ 가 0건일 때: 인증 문의에는 "AI 답변 준비 중" 안내, 고정 문구 경로(컨설팅·불만·범위 밖)는 그대로 */
import { describe, expect, it, vi } from "vitest";
import { runChat, type ChatDeps, type ChatEvent } from "@/lib/chat/run-chat";
import { MSG_COMPLAINT, MSG_CONSULTING_BLOCKED, MSG_OUT_OF_SCOPE, MSG_PREPARING } from "@/lib/prompts/messages";
import type { FaqMatch } from "@/lib/search";

const faq: FaqMatch = { id: "f1", question: "비건 인증 원칙은?", answer: "세 가지 원칙이 있습니다.", source_url: null, cert_type: "vegan", category: "scope", needs_input: false };

async function run(message: string, deps: Partial<ChatDeps>) {
  const unanswered: string[] = [];
  const logs: { route: string; answer: string }[] = [];
  let text = "";
  let route = "";
  for await (const ev of runChat(
    { message },
    {
      logChat: async (r) => (logs.push({ route: r.route, answer: r.answer ?? "" }), { id: "l" }),
      logUnanswered: async (q) => void unanswered.push(q),
      listHistory: async () => [],
      ...deps,
    },
  ) as AsyncGenerator<ChatEvent>) {
    if (ev.type === "meta") route = ev.route;
    if (ev.type === "delta") text += ev.text;
  }
  return { route, text, unanswered, logs };
}

const allowed = async () => ({ label: "allowed" as const, eligibility: false, certSpecified: true });

describe("승인 FAQ 0건", () => {
  it("인증 문의에는 'AI 답변 준비 중' 안내가 나가고 검색·답변 생성은 하지 않는다", async () => {
    const stream = vi.fn(async function* () {
      yield "x";
    });
    const r = await run("비건 인증 원칙이 뭔가요?", { classify: allowed, hasApprovedFaq: async () => false, search: async () => [faq], streamAnswer: stream });
    expect(r.text).toBe(MSG_PREPARING);
    expect(r.text.startsWith("AI 답변 준비 중입니다.")).toBe(true);
    expect(r.route).toBe("handoff");
    expect(stream).not.toHaveBeenCalled();
    expect(r.unanswered).toEqual(["비건 인증 원칙이 뭔가요?"]); // 질문은 미답변 목록에 남아 나중에 FAQ 재료가 된다
    expect(r.logs[0].answer).toBe(MSG_PREPARING);
  });
  it("인증 종류를 되묻지 않고, 인증 이력 안내도 하지 않는다", async () => {
    const listHistory = vi.fn(async () => []);
    const r = await run("고체 탈취제도 반려동물 인증 되나요?", {
      classify: async () => ({ label: "allowed" as const, eligibility: true, certSpecified: false }),
      hasApprovedFaq: async () => false,
      search: async () => [],
      listHistory,
    });
    expect(r.text).toBe(MSG_PREPARING);
    expect(listHistory).not.toHaveBeenCalled();
  });
  it("컨설팅·불만·범위 밖은 평소와 같은 고정 문구", async () => {
    const none = { hasApprovedFaq: async () => false, search: async () => [] as FaqMatch[] };
    expect((await run("어떻게 하면 통과하나요?", { ...none, classify: async () => ({ label: "consulting" as const, eligibility: false, certSpecified: true }) })).text).toBe(MSG_CONSULTING_BLOCKED);
    expect((await run("심사 결과가 부당합니다", { ...none, classify: async () => ({ label: "complaint" as const, eligibility: false, certSpecified: true }) })).text).toBe(MSG_COMPLAINT);
    expect((await run("오늘 날씨", { ...none, classify: async () => ({ label: "out_of_scope" as const, eligibility: false, certSpecified: true }) })).text).toBe(MSG_OUT_OF_SCOPE);
  });
  it("승인 FAQ 가 있으면 평소대로 답한다", async () => {
    const r = await run("비건 인증 원칙이 뭔가요?", {
      classify: allowed,
      hasApprovedFaq: async () => true,
      search: async () => [faq],
      streamAnswer: async function* () {
        yield "세 가지 원칙이 있습니다.";
      },
    });
    expect(r.route).toBe("answered");
    expect(r.text).not.toContain("준비 중");
  });
  it("유무 확인이 실패하면 평소대로 진행한다 (장애 때문에 응대가 막히지 않게)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await run("비건 인증 원칙이 뭔가요?", {
      classify: allowed,
      hasApprovedFaq: async () => Promise.reject(new Error("db down")),
      search: async () => [faq],
      streamAnswer: async function* () {
        yield "세 가지 원칙이 있습니다.";
      },
    });
    expect(r.route).toBe("answered");
    spy.mockRestore();
  });
});
