/**
 * 문서 단위 검수 큐(Phase 13) 핵심 규칙. DB 접근 없이 순수 함수로 두어 테스트한다.
 * 승인은 항상 사람이 누르는 버튼으로만 일어나고, 이 화면에서 건드릴 수 있는 것은
 * "이 문서를 출처로 하는 초안(draft)"뿐이다. 이미 승인된 FAQ와 다른 문서의 FAQ는 수정·삭제할 수 없다.
 */

export interface ReviewRow {
  id: string;
  status: string;
  needs_input: boolean;
  review_hold: boolean;
  source_doc_id: string | null;
}

export interface ReviewEdit {
  id: string;
  question: string;
  answer: string;
  /** 인증 종류: 문서의 값을 이어받지만 카드에서 건별로 바꿀 수 있다 */
  cert_type: string;
  /** 카테고리: AI 판정값을 카드에서 고칠 수 있다 */
  category: string;
}

export const REVIEW_CATEGORIES = ["procedure", "cost", "duration", "document", "scope", "renewal"] as const;

export const MAX_QUESTION = 300;
export const MAX_ANSWER = 3000;
/** 한 번의 일괄 승인 최대 건수 (실수로 수백 건이 한 번에 나가지 않게) */
export const MAX_BULK_APPROVE = 200;

/** 승인할 수정본 검증: 질문·답변이 비어 있지 않고 길이 제한 이내 */
export function validateApproval(e: ReviewEdit): string | null {
  if (!e.question.trim()) return "질문을 입력해 주세요.";
  if (e.question.length > MAX_QUESTION) return `질문은 ${MAX_QUESTION}자 이내로 입력해 주세요.`;
  if (!e.answer.trim()) return "답변이 비어 있는 항목은 승인할 수 없습니다. 답변을 입력해 주세요.";
  if (e.answer.length > MAX_ANSWER) return `답변은 ${MAX_ANSWER}자 이내로 입력해 주세요.`;
  if (!/^[a-z0-9-]+$/.test(e.cert_type)) return "인증 종류를 선택해 주세요.";
  if (!(REVIEW_CATEGORIES as readonly string[]).includes(e.category)) return "카테고리를 선택해 주세요.";
  return null;
}

/** 보류·임시 저장 시 수정본 검증 (답변은 비어 있어도 된다) */
export function validateDraftEdit(e: Pick<ReviewEdit, "question" | "answer" | "cert_type" | "category">): string | null {
  if (!/^[a-z0-9-]+$/.test(e.cert_type)) return "인증 종류를 선택해 주세요.";
  if (!(REVIEW_CATEGORIES as readonly string[]).includes(e.category)) return "카테고리를 선택해 주세요.";
  if (!e.question.trim()) return "질문을 입력해 주세요.";
  if (e.question.length > MAX_QUESTION) return `질문은 ${MAX_QUESTION}자 이내로 입력해 주세요.`;
  if (e.answer.length > MAX_ANSWER) return `답변은 ${MAX_ANSWER}자 이내로 입력해 주세요.`;
  return null;
}

export type ApprovalPlan = { approve: ReviewEdit[]; failed: { id: string; error: string }[] };

/**
 * 승인 요청을 걸러낸다.
 *  - 이 문서의 초안(draft)만 승인한다. 없는 id, 다른 문서의 FAQ, 이미 승인된 항목은 실패로 돌려준다.
 *  - 질문·답변 수정본이 검증을 통과해야 한다. 답변이 비어 있으면 승인할 수 없다.
 *  - 'needs_input' 표시는 답변을 채워 승인하는 순간 해제된다(담당자가 값을 확인해 채운 것으로 본다).
 *  - 같은 id 가 중복되어 있으면 한 번만 처리하고, 최대 MAX_BULK_APPROVE 건까지만 처리한다.
 */
export function planApproval(edits: ReviewEdit[], rows: ReviewRow[], docId: string): ApprovalPlan {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const approve: ReviewEdit[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const e of edits) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (approve.length >= MAX_BULK_APPROVE) {
      failed.push({ id: e.id, error: `한 번에 최대 ${MAX_BULK_APPROVE}건까지 승인할 수 있습니다.` });
      continue;
    }
    const row = byId.get(e.id);
    if (!row) {
      failed.push({ id: e.id, error: "FAQ를 찾을 수 없습니다." });
      continue;
    }
    if (row.source_doc_id !== docId) {
      failed.push({ id: e.id, error: "이 문서의 초안이 아닙니다." });
      continue;
    }
    if (row.status !== "draft") {
      failed.push({ id: e.id, error: "이미 승인된 항목입니다." });
      continue;
    }
    const problem = validateApproval(e);
    if (problem) {
      failed.push({ id: e.id, error: problem });
      continue;
    }
    approve.push(e);
  }
  return { approve, failed };
}

/** 보류·삭제 같은 단건 작업의 대상 확인: 이 문서의 draft 만 가능 */
export function checkTouchable(row: ReviewRow | undefined, docId: string): string | null {
  if (!row) return "FAQ를 찾을 수 없습니다.";
  if (row.source_doc_id !== docId) return "이 문서의 초안이 아닙니다.";
  if (row.status !== "draft") return "승인된 항목은 이 화면에서 바꿀 수 없습니다. FAQ 화면에서 수정하세요.";
  return null;
}

export interface ReviewCounts {
  created: number;
  approved: number;
  /** 아직 검수하지 않은 초안 (보류 제외) */
  pending: number;
  held: number;
}

export function countReview(rows: { status: string; review_hold: boolean }[]): ReviewCounts {
  let approved = 0;
  let pending = 0;
  let held = 0;
  for (const r of rows) {
    if (r.status === "approved") approved++;
    else if (r.review_hold) held++;
    else pending++;
  }
  return { created: rows.length, approved, pending, held };
}
