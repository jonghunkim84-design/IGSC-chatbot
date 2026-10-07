/**
 * Phase 12 문서 단위 FAQ 일괄 초안: 거름망·교체 보호·대상 문서 확인 (stub, 결정적) +
 * 실제 모델로 컨설팅성·타 기관 안내가 탈락하는지 확인.
 */
import { describe, expect, it, vi } from "vitest";
import {
  AUTO_NOTE_PREFIX,
  checkDocumentForFaq,
  classifyReplaceable,
  isApprovalComplete,
  processChunks,
  screenItem,
  type DocFaqDeps,
  type DocFaqDoc,
  type FaqChunk,
  type RawFaqItem,
} from "@/lib/docs/doc-faq";
import { defaultDocFaqDeps } from "@/lib/docs/doc-faq-deps";

const doc: DocFaqDoc = { id: "d1", file_name: "반려동물 인증 안내.pdf", cert_type: "pet-related-product", doc_category: "procedure", status: "extracted" };
const chunk: FaqChunk = {
  page_no: 3,
  section_title: null,
  content: [
    "반려동물 관련 제품 인증은 신청서 접수 후 서류 심사와 현장심사를 거쳐 인증위원회에서 최종 결정합니다.",
    "인증 신청 시 사업자 등록증과 제품 사진, 원부자재 리스트를 제출해야 합니다.",
    "현장심사는 보통 1일 진행됩니다.",
  ].join("\n"),
};

const item = (over: Partial<RawFaqItem> = {}): RawFaqItem => ({
  question: "반려동물 관련 제품 인증 신청 시 필요한 서류는 무엇인가요?",
  variants: ["반려동물 인증 서류"],
  answer: "사업자 등록증과 제품 사진, 원부자재 리스트를 제출해야 합니다.",
  category: "document",
  evidence: ["인증 신청 시 사업자 등록증과 제품 사진, 원부자재 리스트를 제출해야 합니다."],
  kind: "igsc",
  ...over,
});

describe("대상 문서 확인", () => {
  it("추출 완료 + 최신 버전 + 분류가 기타가 아니면 통과", () => {
    expect(checkDocumentForFaq({ status: "extracted", doc_category: "procedure" })).toEqual({ ok: true });
  });
  it("archived(이전 버전)는 거부", () => {
    const r = checkDocumentForFaq({ status: "archived", doc_category: "procedure" });
    expect(r.ok).toBe(false);
  });
  it("추출 전·실패 문서는 거부", () => {
    expect(checkDocumentForFaq({ status: "pending", doc_category: "procedure" }).ok).toBe(false);
    expect(checkDocumentForFaq({ status: "failed", doc_category: "procedure" }).ok).toBe(false);
  });
  it("분류 '기타(초안 제외)'(is_source=false 에 해당) 문서는 거부", () => {
    const r = checkDocumentForFaq({ status: "extracted", doc_category: "other" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("기타");
  });
});

describe("거름망 (stub)", () => {
  it("정상 항목은 draft 로 통과하고 문서의 인증 종류·출처 쪽을 이어받는다", () => {
    const r = screenItem(item(), chunk, doc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.cert_type).toBe("pet-related-product");
      expect(r.draft.source_doc_id).toBe("d1");
      expect(r.draft.source_page).toBe(3);
      expect(r.draft.needs_input).toBe(false);
      expect(r.draft.draft_note.startsWith(AUTO_NOTE_PREFIX)).toBe(true);
    }
  });

  it("a) evidence 가 청크 원문에 없으면 탈락", () => {
    const r = screenItem(item({ evidence: ["청크에 없는 문장입니다."] }), chunk, doc);
    expect(r).toMatchObject({ ok: false, rejected: { stage: "evidence", page: 3 } });
  });

  it("b) 답변의 숫자가 원문에 없으면 탈락", () => {
    const r = screenItem(item({ answer: "현장심사는 보통 5일 진행됩니다.", category: "duration", evidence: ["현장심사는 보통 1일 진행됩니다."] }), chunk, doc);
    expect(r).toMatchObject({ ok: false, rejected: { stage: "numbers" } });
  });

  it("c) 컨설팅성(kind=consulting)이면 탈락하고 사유가 남는다", () => {
    const r = screenItem(item({ kind: "consulting", reason: "서류 작성 요령" }), chunk, doc);
    expect(r).toMatchObject({ ok: false, rejected: { stage: "consulting" } });
    if (!r.ok) expect(r.rejected.reason).toContain("서류 작성 요령");
  });

  it("c) 질문 표현이 '어떻게 하면 통과'면 모델이 igsc 로 판정해도 탈락", () => {
    const r = screenItem(item({ question: "반려동물 인증은 어떻게 하면 통과할 수 있나요?" }), chunk, doc);
    expect(r).toMatchObject({ ok: false, rejected: { stage: "consulting" } });
  });

  it("d) IGSC 소관이 아닌 타 기관 안내(kind=other_authority)는 탈락", () => {
    const r = screenItem(item({ kind: "other_authority", reason: "식약처 제도" }), chunk, doc);
    expect(r).toMatchObject({ ok: false, rejected: { stage: "other_authority" } });
  });

  it("비용·기간인데 원문에 수치가 없으면 빈 답변 + needs_input=true 초안", () => {
    const r = screenItem(
      item({ question: "반려동물 인증 비용은 얼마인가요?", category: "cost", answer: "비용은 약 300만원입니다.", evidence: ["인증 신청 시 사업자 등록증과 제품 사진, 원부자재 리스트를 제출해야 합니다."] }),
      chunk,
      doc,
    );
    // 답변에 숫자(300)가 있으면 숫자 검증에서 탈락한다 (원문에 없는 값)
    expect(r.ok).toBe(false);
    const blank = screenItem(item({ question: "반려동물 인증 비용은 얼마인가요?", category: "cost", answer: "", evidence: ["인증 신청 시 사업자 등록증과 제품 사진, 원부자재 리스트를 제출해야 합니다."] }), chunk, doc);
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      expect(blank.draft.answer).toBe("");
      expect(blank.draft.needs_input).toBe(true);
    }
  });

  it("원문에 수치가 있는 기간은 답변과 함께 통과", () => {
    const r = screenItem(item({ question: "반려동물 인증 현장심사는 며칠 걸리나요?", category: "duration", answer: "현장심사는 보통 1일 진행됩니다.", evidence: ["현장심사는 보통 1일 진행됩니다."] }), chunk, doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.needs_input).toBe(false);
  });
});

describe("processChunks 중복·오류 처리 (stub)", () => {
  const make = (items: RawFaqItem[], dup: (q: string) => boolean = () => false): DocFaqDeps => ({
    extract: vi.fn(async () => items),
    isDuplicate: vi.fn(async (q: string) => (dup(q) ? { duplicate: true, of: "기존 질문", id: "faq-sim" } : { duplicate: false })),
  });

  it("e) 기존 FAQ와 같은 질문이면 탈락(완전 일치)하고 겹치는 FAQ 링크용 id 를 돌려준다", async () => {
    const r = await processChunks([chunk], doc, [{ id: "faq-1", cert_type: "pet-related-product", question: "반려동물 관련 제품 인증 신청 시 필요한 서류는 무엇인가요?" }], make([item()]));
    expect(r.drafts).toHaveLength(0);
    expect(r.rejected[0]).toMatchObject({ stage: "duplicate", faq_id: "faq-1" });
    expect(r.rejected[0].reason).toContain("기존 FAQ와 중복");
  });

  it("같은 질문이라도 인증 종류가 다르면 중복이 아니다 (식품 비건 ≠ 화장품 비건처럼 별개)", async () => {
    const deps = make([item()]);
    const r = await processChunks([chunk], doc, [{ id: "faq-9", cert_type: "vegan", question: "반려동물 관련 제품 인증 신청 시 필요한 서류는 무엇인가요?" }], deps);
    expect(r.drafts).toHaveLength(1);
    // 중복 판정은 이 문서의 인증 종류로 한정해 호출된다
    expect(deps.isDuplicate).toHaveBeenCalledWith(expect.any(String), "pet-related-product", expect.any(Array));
  });

  it("같은 문서를 두 번 처리해도 FAQ가 중복 생성되지 않는다", async () => {
    const first = await processChunks([chunk], doc, [], make([item()]));
    expect(first.drafts).toHaveLength(1);
    // 첫 실행에서 저장된 초안이 두 번째 실행의 기존 FAQ 가 된다 (손대지 않아 교체되지 않았거나, 수정해 보호된 경우)
    const saved = first.drafts.map((d, i) => ({ id: `saved-${i}`, cert_type: d.cert_type, question: d.question }));
    const second = await processChunks([chunk], doc, saved, make([item()]));
    expect(second.drafts).toHaveLength(0);
    expect(second.rejected[0]).toMatchObject({ stage: "duplicate", faq_id: "saved-0" });
  });

  it("e) 의미가 같은 중복은 중복 검사에서 탈락", async () => {
    const deps = make([item()], () => true);
    const r = await processChunks([chunk], doc, [{ cert_type: "common", question: "인증 서류는?" }], deps);
    expect(r.drafts).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("중복");
    expect(r.rejected[0].faq_id).toBe("faq-sim");
  });

  it("같은 작업 안에서 같은 질문이 두 번 나오면 하나만 만든다", async () => {
    const r = await processChunks([chunk, chunk], doc, [], make([item()]));
    expect(r.drafts).toHaveLength(1);
    expect(r.rejected.some((x) => x.stage === "duplicate")).toBe(true);
  });

  it("한 청크 추출이 실패해도 다른 청크는 계속 처리하고 실패 사유를 남긴다", async () => {
    const deps: DocFaqDeps = {
      extract: vi.fn(async (c: FaqChunk) => {
        if (c.page_no === 1) throw new Error("boom");
        return [item()];
      }),
      isDuplicate: vi.fn(async () => ({ duplicate: false })),
    };
    const r = await processChunks([{ ...chunk, page_no: 1 }, chunk], doc, [], deps);
    expect(r.drafts).toHaveLength(1);
    expect(r.rejected[0]).toMatchObject({ stage: "error", page: 1 });
  });

  it("중복 검사가 실패하면 만들지 않는다 (중복 초안이 쌓이지 않게)", async () => {
    const deps: DocFaqDeps = { extract: vi.fn(async () => [item()]), isDuplicate: vi.fn(async () => Promise.reject(new Error("api down"))) };
    const r = await processChunks([chunk], doc, [], deps);
    expect(r.drafts).toHaveLength(0);
    expect(r.rejected[0].stage).toBe("error");
  });
});

describe("재실행 교체 보호", () => {
  const T0 = "2026-10-03T10:00:00.000Z";
  const row = (over: Partial<Parameters<typeof classifyReplaceable>[0][number]> = {}) => ({
    id: "x",
    status: "draft",
    draft_note: `${AUTO_NOTE_PREFIX} 문서.pdf p.1`,
    source_unanswered_id: null,
    created_at: T0,
    updated_at: T0,
    ...over,
  });

  it("손대지 않은 자동 초안은 교체 대상", () => {
    expect(classifyReplaceable([row({ id: "a" })])).toEqual({ replace: ["a"], protect: [] });
  });
  it("승인된 FAQ는 교체도 보호 목록도 아니고 아예 대상에서 빠진다", () => {
    expect(classifyReplaceable([row({ id: "a", status: "approved" })])).toEqual({ replace: [], protect: [] });
  });
  it("담당자가 수정한 초안(updated_at 이 뒤)은 보호", () => {
    expect(classifyReplaceable([row({ id: "a", updated_at: "2026-10-03T10:30:00.000Z" })])).toEqual({ replace: [], protect: ["a"] });
  });
  it("미답변 질문에서 만든 초안은 보호", () => {
    expect(classifyReplaceable([row({ id: "a", source_unanswered_id: "u1", draft_note: "문서에서 초안을 만들었습니다." })])).toEqual({ replace: [], protect: ["a"] });
  });
  it("이 기능이 만든 것이 아닌 초안(메모 접두어 없음)은 보호", () => {
    expect(classifyReplaceable([row({ id: "a", draft_note: "직접 등록" })])).toEqual({ replace: [], protect: ["a"] });
  });
});

describe("실제 모델 — 컨설팅성·타 기관 안내 탈락", () => {
  const mixed: FaqChunk = {
    page_no: 5,
    section_title: null,
    content: [
      "반려동물 관련 제품 인증은 인증 신청서 접수, 서류 심사, 현장심사, 인증위원회 결정 순서로 진행됩니다.",
      "인증 기준을 통과하려면 성분표를 미리 정리하고 교차오염 방지 절차를 추가하여 심사 전에 보완하시기 바랍니다.",
      "식품의약품안전처의 HACCP 인증을 받으려면 한국식품안전관리인증원에 신청서를 제출하고 현장 평가를 받아야 합니다.",
    ].join("\n"),
  };

  it("IGSC 사실 정보는 초안이 되고, 컨설팅성·타 기관 안내는 탈락한다", async () => {
    const r = await processChunks([mixed], doc, [], { extract: defaultDocFaqDeps.extract, isDuplicate: async () => ({ duplicate: false }) });
    // 통과한 초안에는 컨설팅 조언이나 HACCP 절차가 없어야 한다
    for (const d of r.drafts) {
      expect(d.answer).not.toMatch(/HACCP|식품의약품안전처|한국식품안전관리인증원/);
      expect(d.answer).not.toMatch(/성분표를 미리 정리|교차오염 방지 절차를 추가/);
      expect(d.source_doc_id).toBe("d1");
      expect(d.source_page).toBe(5);
    }
    // 절차 사실 정보는 최소 1건 만들어진다
    expect(r.drafts.length).toBeGreaterThanOrEqual(1);
    // 컨설팅성 또는 타 기관 안내가 탈락 사유와 함께 남는다
    const stages = r.rejected.map((x) => x.stage);
    expect(stages.some((s) => s === "consulting" || s === "other_authority")).toBe(true);
    for (const x of r.rejected) expect(x.reason.length).toBeGreaterThan(0);
  }, 90000);
});

describe("승인 완료 문서 (FAQ 초안 만들기 버튼 숨김 기준)", () => {
  const all = { created: 8, approved: 8, pending: 0, held: 0 };
  const done = { status: "done", limit_reached: false, error_count: 0 };

  it("전부 승인되고 작업이 정상 종료되었으면 완료", () => expect(isApprovalComplete(all, done)).toBe(true));
  it("작업 기록이 없어도(스크립트·직접 등록으로 만든 FAQ) 전부 승인이면 완료", () => expect(isApprovalComplete(all, null)).toBe(true));
  it("미검수가 남아 있으면 버튼을 계속 보여준다", () => expect(isApprovalComplete({ ...all, approved: 6, pending: 2 }, done)).toBe(false));
  it("보류가 남아 있으면 완료가 아니다", () => expect(isApprovalComplete({ ...all, approved: 7, held: 1 }, done)).toBe(false));
  it("FAQ 가 하나도 없으면 완료가 아니다", () => {
    expect(isApprovalComplete({ created: 0, approved: 0, pending: 0, held: 0 }, done)).toBe(false);
    expect(isApprovalComplete(undefined, done)).toBe(false);
  });
  it("진행 중이거나 실패한 작업은 이어서/다시 해야 하므로 완료가 아니다", () => {
    expect(isApprovalComplete(all, { ...done, status: "running" })).toBe(false);
    expect(isApprovalComplete(all, { ...done, status: "failed" })).toBe(false);
  });
  it("파일당 상한에 도달해 남은 구간이 처리되지 않았다면 완료가 아니다", () => expect(isApprovalComplete(all, { ...done, limit_reached: true })).toBe(false));
  it("처리 실패로 탈락한 항목이 있으면 다시 만들기로 재시도할 수 있게 버튼을 보여준다", () => expect(isApprovalComplete(all, { ...done, error_count: 2 })).toBe(false));
  it("승인된 FAQ 를 초안으로 되돌리면(인계 전 되돌리기 등) 버튼이 다시 나타난다", () => expect(isApprovalComplete({ created: 8, approved: 0, pending: 8, held: 0 }, done)).toBe(false));
});
