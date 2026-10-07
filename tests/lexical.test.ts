/**
 * 어휘 일치 보강(lexicalMatches): 질문이 FAQ 의 질문·다른 표현과 사실상 같으면 모델 선택과 무관하게 먼저 포함한다.
 * (FAQ 가 수백 건이면 모델이 정확히 같은 표현의 항목도 놓칠 수 있다.)
 */
import { describe, expect, it, vi } from "vitest";
import { lexicalMatches } from "@/lib/search/lexical";
import { createSearchFaq } from "@/lib/search";
import { invalidateFaqCache } from "@/lib/search/faq-cache";

const items = [
  { id: "food", question: "식품 분야에서 인증받을 수 있는 종류에는 어떤 것이 있나요?", variants: [] },
  { id: "overview", question: "귀사는 어떤 종류의 인증을 하나요?", variants: ["어떤 인증을 받을 수 있나요?", "어떤 종류의 인증을 하는지 알려주세요", "어떤 인증 서비스를 제공하나요?"] },
  { id: "cost", question: "비건 인증 비용은 얼마인가요?", variants: ["비건인증 얼마"] },
];

describe("lexicalMatches", () => {
  it("다른 표현(variants)이 질문 대부분을 차지하면 일치 (앞에 '귀사는'이 붙은 정도)", () => {
    expect(lexicalMatches("귀사는 어떤 종류의 인증을 하는지 알려주세요", items)).toEqual(["overview"]);
  });
  it("FAQ 질문과 같은 질문은 일치 (물음표·공백 무시)", () => {
    expect(lexicalMatches("귀사는 어떤 종류의 인증을 하나요", items)).toEqual(["overview"]);
    expect(lexicalMatches("비건 인증 비용은 얼마인가요?", items)).toEqual(["cost"]);
  });
  it("고객 질문이 FAQ 표현보다 짧아도 대부분을 차지하면 일치", () => {
    expect(lexicalMatches("어떤 인증을 받을 수 있나요", items)).toEqual(["overview"]);
  });
  it("표현이 일부만 겹치면(긴 질문 속에 짧은 표현) 일치로 보지 않는다", () => {
    expect(lexicalMatches("저희는 화장품 제조사인데 어떤 인증을 받을 수 있나요 비용과 기간도 함께 알고 싶습니다", items)).toEqual([]);
  });
  it("8자 미만의 짧은 표현은 일치로 보지 않는다 (너무 흔한 말 방지)", () => {
    expect(lexicalMatches("비건인증 얼마", [{ id: "x", question: "비건 인증 얼마?", variants: [] }])).toEqual([]);
  });
  it("관련 없는 질문은 일치하지 않는다", () => expect(lexicalMatches("반려동물 인증 서류가 궁금합니다", items)).toEqual([]));
});

describe("searchFaq 에서의 사용", () => {
  const index = items.map((f) => ({ ...f, cert_type: "common" }));
  const build = (selected: number[]) => {
    invalidateFaqCache();
    return createSearchFaq({
      loadIndex: async () => index,
      loadAnswers: async (ids) => ids.map((id) => ({ id, question: id, answer: "답", source_url: null, cert_type: "common", category: "scope" as const, needs_input: false })),
      select: vi.fn(async () => selected),
    });
  };

  it("모델이 일치하는 항목을 놓쳐도 먼저 포함하고, 모델이 고른 항목이 뒤에 붙는다", async () => {
    const r = await build([0])("귀사는 어떤 종류의 인증을 하는지 알려주세요"); // 모델은 식품(0)만 고름
    expect(r.map((m) => m.id)).toEqual(["overview", "food"]);
  });
  it("모델이 이미 고른 항목은 중복되지 않는다", async () => {
    const r = await build([1, 0])("귀사는 어떤 종류의 인증을 하는지 알려주세요");
    expect(r.map((m) => m.id)).toEqual(["overview", "food"]);
  });
  it("일치가 없으면 모델 선택 그대로", async () => {
    const r = await build([2])("반려동물 인증 서류가 궁금합니다");
    expect(r.map((m) => m.id)).toEqual(["cost"]);
  });
});
