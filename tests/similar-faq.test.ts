/**
 * Phase 14-2 유사 FAQ 검사 (findSimilarFaq): 같은 인증 종류만 비교·완전 일치·자기 자신 제외 (stub, 결정적) +
 * 실제 모델로 "인증 종류가 다르면 중복 아님 / 표현만 다르면 중복" 확인.
 */
import { describe, expect, it, vi } from "vitest";
import { defaultSimilarDeps, findSimilarFaq, type SimilarDeps, type SimilarFaq } from "@/lib/docs/similar-faq";

const faqs: SimilarFaq[] = [
  { id: "v1", question: "식품 비건(Vegan) 인증의 원칙은 무엇인가요?", status: "approved", cert_type: "vegan" },
  { id: "v2", question: "화장품 비건(Vegan) 인증의 원칙은 무엇인가요?", status: "draft", cert_type: "vegan" },
  { id: "v3", question: "비건 인증 신청 시 필요한 서류는 무엇인가요?", status: "approved", cert_type: "vegan" },
  { id: "o1", question: "유기농 인증의 원칙은 무엇인가요?", status: "approved", cert_type: "organic" },
];

const deps = (select: SimilarDeps["select"]): SimilarDeps => ({
  listFaqs: vi.fn(async (certType?: string) => (certType ? faqs.filter((f) => f.cert_type === certType) : faqs)),
  select: vi.fn(select),
});

describe("findSimilarFaq (stub)", () => {
  it("같은 인증 종류의 목록만 모델에 넘긴다 (다른 인증 종류는 비교 대상이 아니다)", async () => {
    const d = deps(async () => []);
    await findSimilarFaq("비건 인증 원칙", "vegan", {}, d);
    const list = (d.select as ReturnType<typeof vi.fn>).mock.calls[0][1] as SimilarFaq[];
    expect(list.every((f) => f.cert_type === "vegan")).toBe(true);
    expect(list.some((f) => f.id === "o1")).toBe(false);
  });

  it("완전히 같은 질문은 모델 호출 없이 찾는다 (공백·대소문자 무시)", async () => {
    const d = deps(async () => []);
    const r = await findSimilarFaq("식품  비건(vegan) 인증의 원칙은 무엇인가요?", "vegan", {}, d);
    expect(r.map((f) => f.id)).toEqual(["v1"]);
  });

  it("모델이 고른 항목을 돌려준다 (approved·draft 모두)", async () => {
    const d = deps(async (_q, list) => [list.findIndex((f) => f.id === "v2")]);
    const r = await findSimilarFaq("화장품 비건 인증 원칙이 뭔가요", "vegan", {}, d);
    expect(r).toMatchObject([{ id: "v2", status: "draft" }]);
  });

  it("수정 중인 FAQ 자신(excludeId)은 제외한다", async () => {
    const d = deps(async () => []);
    const r = await findSimilarFaq("식품 비건(Vegan) 인증의 원칙은 무엇인가요?", "vegan", { excludeId: "v1" }, d);
    expect(r).toEqual([]);
  });

  it("같은 작업에서 방금 만든 질문(extra)과도 비교한다", async () => {
    const d = deps(async () => []);
    const extra: SimilarFaq = { id: "new-0", question: "비건 인증 환불 규정은 어떻게 되나요?", status: "draft", cert_type: "vegan" };
    const r = await findSimilarFaq("비건 인증 환불 규정은 어떻게 되나요?", "vegan", { extra: [extra] }, d);
    expect(r.map((f) => f.id)).toEqual(["new-0"]);
  });

  it("certType 이 다른 extra 는 비교하지 않는다", async () => {
    const d = deps(async () => []);
    const extra: SimilarFaq = { id: "x", question: "비건 인증 환불 규정은 어떻게 되나요?", status: "draft", cert_type: "organic" };
    expect(await findSimilarFaq("비건 인증 환불 규정은 어떻게 되나요?", "vegan", { extra: [extra] }, d)).toEqual([]);
  });

  it("비교할 FAQ 가 없거나 질문이 비어 있으면 빈 목록", async () => {
    expect(await findSimilarFaq("   ", "vegan", {}, deps(async () => []))).toEqual([]);
    expect(await findSimilarFaq("질문", "no-such-cert", {}, deps(async () => []))).toEqual([]);
  });
});

describe("findSimilarFaq — 실제 모델", () => {
  const real: SimilarDeps = { ...defaultSimilarDeps, listFaqs: async (certType) => (certType ? faqs.filter((f) => f.cert_type === certType) : faqs) };

  it("표현만 다른 같은 질문은 유사로 찾는다", async () => {
    const r = await findSimilarFaq("비건 인증 신청할 때 어떤 서류를 준비해야 하나요?", "vegan", {}, real);
    expect(r.map((f) => f.id)).toContain("v3");
  }, 60000);

  it("같은 비건 인증 코드라도 식품 비건과 화장품 비건은 별개다", async () => {
    const r = await findSimilarFaq("식품 비건 인증 원칙이 무엇인가요?", "vegan", {}, real);
    const ids = r.map((f) => f.id);
    expect(ids).toContain("v1");
    expect(ids).not.toContain("v2"); // 화장품 비건은 중복이 아니다
  }, 60000);

  it("인증 종류가 다르면 같은 질문 형태여도 중복이 아니다", async () => {
    const r = await findSimilarFaq("유기농 인증의 원칙은 무엇인가요?", "vegan", {}, real);
    expect(r.map((f) => f.id)).not.toContain("o1");
  }, 60000);
});
