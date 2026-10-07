/**
 * 부분 안내(PARTIAL) 시나리오.
 * - 표식 처리·담당자 연결 문구·미답변 기록은 stub 으로 결정적으로 검증한다.
 * - 마지막 케이스는 실제 Claude 가 "FAQ가 다루는 범위까지만 답하고 나머지는 담당자 확인"으로 연결하는지 확인한다.
 */
import { describe, expect, it } from "vitest";
import { NO_ANSWER_SENTINEL, PARTIAL_SENTINEL } from "@/lib/prompts/answer";
import { MSG_HANDOFF, MSG_PARTIAL_FALLBACK_LINE, MSG_PARTIAL_HANDOFF } from "@/lib/prompts/messages";
import { FIXTURE_FAQS, chat, fixtureSearch } from "./helpers";

const stream = (...chunks: string[]) =>
  async function* () {
    for (const c of chunks) yield c;
  };

describe("부분 안내 — 표식 처리 (stub)", () => {
  it("PARTIAL 표식은 고객에게 보이지 않고, 담당자 연결 문구가 붙으며 미답변에 기록된다", async () => {
    const r = await chat("비건 인증 원칙과 다른 인증과의 차이점을 알려주세요", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
      streamAnswer: stream(`${PARTIAL_SENTINEL} 비건 인증은 세 가지 원칙이 있습니다. `, "말씀하신 다른 인증과의 비교는 담당자가 확인해 드립니다."),
    });
    expect(r.text).not.toContain(PARTIAL_SENTINEL);
    expect(r.text.startsWith("비건 인증은 세 가지 원칙이 있습니다.")).toBe(true);
    expect(r.text).toContain("담당자가 확인해 드립니다");
    expect(r.text).toContain(MSG_PARTIAL_HANDOFF);
    expect(r.route).toBe("answered");
    expect(r.unanswered).toHaveLength(1);
    expect(r.logs[0]).toMatchObject({ route: "answered", matched: 1 });
  });

  it("표식이 여러 조각으로 나뉘어 들어와도 제거된다", async () => {
    const r = await chat("비건 인증 원칙과 다른 인증과의 차이점을 알려주세요", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
      streamAnswer: stream("[[PAR", "TIAL]]", "원칙은 세 가지입니다. 말씀하신 비교는 담당자가 확인해 드립니다."),
    });
    expect(r.text).not.toContain("[[");
    expect(r.text).toContain("원칙은 세 가지입니다.");
    expect(r.unanswered).toHaveLength(1);
  });

  it("표식이 없는 일반 답변은 기존과 같다 (담당자 연결 문구·미답변 기록 없음)", async () => {
    const r = await chat("비건 인증 원칙이 뭐예요?", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
      streamAnswer: stream("동물 및 동물 유래 성분 금지 등 세 가지 원칙이 있습니다."),
    });
    expect(r.text).not.toContain(MSG_PARTIAL_HANDOFF);
    expect(r.unanswered).toEqual([]);
  });

  it("NO_ANSWER 는 기존대로 담당자 이관 문구", async () => {
    const r = await chat("비건 인증 원칙이 뭐예요?", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
      streamAnswer: stream(NO_ANSWER_SENTINEL),
    });
    expect(r.route).toBe("handoff");
    expect(r.text).toBe(MSG_HANDOFF);
    expect(r.unanswered).toHaveLength(1);
  });
});

describe("부분 안내 — 실제 모델", () => {
  it("FAQ에 한쪽만 있는 비교 질문 → 있는 범위까지 안내하고 나머지는 담당자 확인으로 연결", async () => {
    const r = await chat("비건 인증 원칙이 뭔지, 그리고 클린뷰티 인증과 뭐가 다른지 알려주세요", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
    });
    expect(r.route).toBe("answered");
    expect(r.text).not.toContain(PARTIAL_SENTINEL);
    expect(r.text).toContain("교차 오염"); // FAQ 범위 안내
    expect(r.text).toMatch(/담당자가 확인해 드립니다/);
    expect(r.text).toContain(MSG_PARTIAL_HANDOFF);
    expect(r.unanswered).toHaveLength(1);
  }, 60000);
});

describe("부분 안내 — 길이 제한 보완", () => {
  it("PARTIAL 인데 연결 문장 없이 끝나면 고정 문장을 붙인다", async () => {
    const r = await chat("비건 인증 원칙과 다른 인증과의 차이점을 알려주세요", {
      search: fixtureSearch([FIXTURE_FAQS[1]]),
      streamAnswer: stream(`${PARTIAL_SENTINEL}비건 인증에는 세 가지 원칙이 있습니다. 첫째, 동물성 원료를`),
    });
    expect(r.text).toContain(MSG_PARTIAL_FALLBACK_LINE);
    expect(r.text).toContain(MSG_PARTIAL_HANDOFF);
    expect(r.unanswered).toHaveLength(1);
  });
});
