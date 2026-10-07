/**
 * Phase 13 검수 큐 규칙: 승인 대상 거름·단건 작업 대상 확인·건수 집계 (순수 함수, 결정적).
 * DB 반영(수정본 저장·승인·보류·삭제)은 scripts 의 실제 DB 점검으로 확인한다.
 */
import { describe, expect, it } from "vitest";
import { MAX_BULK_APPROVE, checkTouchable, countReview, planApproval, validateApproval, validateDraftEdit, type ReviewRow } from "@/lib/docs/doc-review";

const DOC = "doc-1";
const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({ id: "a", status: "draft", needs_input: false, review_hold: false, source_doc_id: DOC, ...over });
const edit = (id: string, over: Partial<{ question: string; answer: string; cert_type: string; category: string }> = {}) => ({ id, question: "비건 인증 서류는 무엇인가요?", answer: "신청서와 제품 목록이 필요합니다.", cert_type: "vegan", category: "document", ...over });

describe("승인 수정본 검증", () => {
  it("질문·답변이 있으면 통과", () => expect(validateApproval(edit("a"))).toBeNull());
  it("답변이 비어 있으면 승인 불가", () => expect(validateApproval(edit("a", { answer: "  " }))).toContain("답변"));
  it("질문이 비어 있으면 승인 불가", () => expect(validateApproval(edit("a", { question: "" }))).toContain("질문"));
  it("길이 제한 초과", () => {
    expect(validateApproval(edit("a", { question: "가".repeat(301) }))).toContain("300");
    expect(validateApproval(edit("a", { answer: "가".repeat(3001) }))).toContain("3000");
  });
  it("보류·임시 저장은 답변이 비어 있어도 된다", () => expect(validateDraftEdit({ question: "질문", answer: "", cert_type: "vegan", category: "scope" })).toBeNull());
  it("인증 종류·카테고리는 올바른 값이어야 한다 (건별 변경 값 검증)", () => {
    expect(validateApproval(edit("a", { cert_type: "Bad Code" }))).toContain("인증 종류");
    expect(validateApproval(edit("a", { category: "nope" }))).toContain("카테고리");
    expect(validateDraftEdit({ question: "질문", answer: "", cert_type: "", category: "scope" })).toContain("인증 종류");
  });
  it("인증 종류·카테고리를 바꾼 수정본은 그 값 그대로 승인 대상이 된다", () => {
    const p = planApproval([edit("a", { cert_type: "upcycle", category: "procedure" })], [{ id: "a", status: "draft", needs_input: false, review_hold: false, source_doc_id: "doc-1" }], "doc-1");
    expect(p.approve[0]).toMatchObject({ cert_type: "upcycle", category: "procedure" });
  });
});

describe("승인 계획 (planApproval)", () => {
  it("이 문서의 초안은 승인 대상, 수정본이 그대로 전달된다", () => {
    const p = planApproval([edit("a", { answer: "수정한 답변입니다." })], [row()], DOC);
    expect(p.approve).toEqual([{ id: "a", question: "비건 인증 서류는 무엇인가요?", answer: "수정한 답변입니다.", cert_type: "vegan", category: "document" }]);
    expect(p.failed).toEqual([]);
  });

  it("일괄 승인은 요청에 포함된(선택한) 항목에만 적용된다", () => {
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const p = planApproval([edit("a"), edit("c")], rows, DOC);
    expect(p.approve.map((e) => e.id)).toEqual(["a", "c"]); // b 는 요청에 없으므로 승인되지 않는다
  });

  it("다른 문서의 FAQ는 승인할 수 없다", () => {
    const p = planApproval([edit("a")], [row({ source_doc_id: "other-doc" })], DOC);
    expect(p.approve).toHaveLength(0);
    expect(p.failed[0].error).toContain("이 문서");
  });

  it("이미 승인된 항목은 다시 처리하지 않는다", () => {
    const p = planApproval([edit("a")], [row({ status: "approved" })], DOC);
    expect(p.approve).toHaveLength(0);
    expect(p.failed[0].error).toContain("이미 승인");
  });

  it("없는 id 는 실패로 돌려준다", () => {
    const p = planApproval([edit("zzz")], [row()], DOC);
    expect(p.failed[0]).toMatchObject({ id: "zzz" });
  });

  it("답변이 비어 있는 항목(담당자 입력 필요 포함)은 승인되지 않는다", () => {
    const p = planApproval([edit("a", { answer: "" })], [row({ needs_input: true })], DOC);
    expect(p.approve).toHaveLength(0);
    expect(p.failed[0].error).toContain("답변");
  });

  it("담당자 입력 필요 항목도 답변을 채워 보내면 승인 대상이 된다", () => {
    const p = planApproval([edit("a", { answer: "300만원입니다." })], [row({ needs_input: true })], DOC);
    expect(p.approve).toHaveLength(1);
  });

  it("같은 id 가 중복되면 한 번만 처리한다", () => {
    const p = planApproval([edit("a"), edit("a")], [row()], DOC);
    expect(p.approve).toHaveLength(1);
    expect(p.failed).toHaveLength(0);
  });

  it(`한 번에 최대 ${MAX_BULK_APPROVE}건까지만 승인한다`, () => {
    const ids = Array.from({ length: MAX_BULK_APPROVE + 5 }, (_, i) => `id-${i}`);
    const p = planApproval(ids.map((id) => edit(id)), ids.map((id) => row({ id })), DOC);
    expect(p.approve).toHaveLength(MAX_BULK_APPROVE);
    expect(p.failed).toHaveLength(5);
  });
});

describe("보류·삭제 대상 확인 (checkTouchable)", () => {
  it("이 문서의 초안이면 가능", () => expect(checkTouchable(row(), DOC)).toBeNull());
  it("승인된 항목은 이 화면에서 바꿀 수 없다", () => expect(checkTouchable(row({ status: "approved" }), DOC)).toContain("승인된"));
  it("다른 문서의 FAQ는 불가", () => expect(checkTouchable(row({ source_doc_id: "x" }), DOC)).toContain("이 문서"));
  it("없는 항목은 불가", () => expect(checkTouchable(undefined, DOC)).toContain("찾을 수 없습니다"));
});

describe("건수 집계 (countReview)", () => {
  it("생성·승인·미검수·보류를 센다 (보류는 미검수에서 제외)", () => {
    const c = countReview([
      { status: "approved", review_hold: false },
      { status: "draft", review_hold: false },
      { status: "draft", review_hold: false },
      { status: "draft", review_hold: true },
    ]);
    expect(c).toEqual({ created: 4, approved: 1, pending: 2, held: 1 });
  });
});
