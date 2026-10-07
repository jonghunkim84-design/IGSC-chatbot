import "server-only";
import { createServerClient } from "./server";
import type { Faq } from "./types";
import { approvalFields } from "./admin-faq";
import { countReview, type ReviewCounts, type ReviewEdit, type ReviewRow } from "@/lib/docs/doc-review";

/** 0008 마이그레이션 전에는 review_hold 컬럼이 없다. 있으면 그대로, 없으면 컬럼 없이 다시 읽는다. */
const isMissingColumn = (err: { code?: string; message?: string } | null) => !!err && (err.code === "42703" || /review_hold/.test(err.message ?? ""));

export interface ReviewFaq extends Pick<Faq, "id" | "question" | "answer" | "cert_type" | "category" | "status" | "needs_input" | "source_page" | "source_evidence" | "draft_note" | "created_at"> {
  review_hold: boolean;
}

const COLS = "id, question, answer, cert_type, category, status, needs_input, source_page, source_evidence, draft_note, created_at";

/** 이 문서를 출처로 하는 FAQ 전체 (승인·초안) */
export async function listReviewFaqs(documentId: string): Promise<ReviewFaq[]> {
  const sb = createServerClient();
  let res = await sb.from("faq").select(`${COLS}, review_hold`).eq("source_doc_id", documentId).order("created_at").order("id");
  if (isMissingColumn(res.error)) res = (await sb.from("faq").select(COLS).eq("source_doc_id", documentId).order("created_at").order("id")) as typeof res;
  if (res.error) throw res.error;
  return ((res.data ?? []) as unknown as Partial<ReviewFaq>[]).map((r) => ({ ...(r as ReviewFaq), review_hold: r.review_hold ?? false }));
}

/** 문서 id 목록별 초안 현황 (목록 화면용) */
export async function docReviewCounts(documentIds: string[]): Promise<Map<string, ReviewCounts>> {
  const out = new Map<string, ReviewCounts>();
  if (documentIds.length === 0) return out;
  const sb = createServerClient();
  let res = await sb.from("faq").select("source_doc_id, status, review_hold").in("source_doc_id", documentIds);
  if (isMissingColumn(res.error)) res = (await sb.from("faq").select("source_doc_id, status").in("source_doc_id", documentIds)) as typeof res;
  if (res.error) throw res.error;
  const byDoc = new Map<string, { status: string; review_hold: boolean }[]>();
  for (const r of (res.data ?? []) as unknown as { source_doc_id: string; status: string; review_hold?: boolean }[]) {
    const list = byDoc.get(r.source_doc_id) ?? [];
    list.push({ status: r.status, review_hold: r.review_hold ?? false });
    byDoc.set(r.source_doc_id, list);
  }
  for (const [id, rows] of byDoc) out.set(id, countReview(rows));
  return out;
}

/** 검증용으로 필요한 최소 컬럼 */
export async function getReviewRows(ids: string[]): Promise<ReviewRow[]> {
  if (ids.length === 0) return [];
  const sb = createServerClient();
  let res = await sb.from("faq").select("id, status, needs_input, source_doc_id, review_hold").in("id", ids);
  if (isMissingColumn(res.error)) res = (await sb.from("faq").select("id, status, needs_input, source_doc_id").in("id", ids)) as typeof res;
  if (res.error) throw res.error;
  return ((res.data ?? []) as unknown as Partial<ReviewRow>[]).map((r) => ({ ...(r as ReviewRow), review_hold: r.review_hold ?? false }));
}

/**
 * 수정본을 저장하면서 승인한다. 승인되는 순간 보류·담당자 입력 필요 표시를 해제한다.
 * 조건(status='draft' · 이 문서의 FAQ)을 UPDATE 에도 다시 걸어, 검증 뒤에 상태가 바뀐 항목은 건드리지 않는다.
 * 돌려주는 값은 실제로 승인된 id 목록이다.
 */
export async function approveEdits(documentId: string, edits: ReviewEdit[], approver: string): Promise<string[]> {
  const sb = createServerClient();
  const done: string[] = [];
  for (const e of edits) {
    // 건별로 수정본(질문·답변·인증 종류·카테고리)을 저장하고 승인자·시각을 남긴다 (일괄 승인도 항목마다 기록)
    const patch = {
      question: e.question.trim(),
      answer: e.answer.trim(),
      cert_type: e.cert_type,
      category: e.category,
      needs_input: false,
      status: "approved",
      review_hold: false,
      ...approvalFields(approver),
    };
    let res = await sb.from("faq").update(patch).eq("id", e.id).eq("source_doc_id", documentId).eq("status", "draft").select("id");
    if (isMissingColumn(res.error)) {
      const { review_hold: _unused, ...withoutHold } = patch;
      void _unused;
      res = await sb.from("faq").update(withoutHold).eq("id", e.id).eq("source_doc_id", documentId).eq("status", "draft").select("id");
    }
    if (res.error) throw res.error;
    if ((res.data?.length ?? 0) > 0) done.push(e.id);
  }
  return done;
}

/** 보류 또는 보류 해제. 수정본이 있으면 함께 저장한다 (status 는 draft 그대로). */
export async function setHold(documentId: string, id: string, hold: boolean, edit?: { question: string; answer: string; cert_type: string; category: string }): Promise<boolean> {
  const patch: Record<string, unknown> = { review_hold: hold };
  if (edit) {
    patch.question = edit.question.trim();
    patch.answer = edit.answer.trim();
    patch.cert_type = edit.cert_type;
    patch.category = edit.category;
  }
  const { data, error } = await createServerClient().from("faq").update(patch).eq("id", id).eq("source_doc_id", documentId).eq("status", "draft").select("id");
  if (error) {
    if (isMissingColumn(error)) throw new Error("보류 기능을 쓰려면 DB 마이그레이션 0008 이 필요합니다.");
    throw error;
  }
  return (data?.length ?? 0) > 0;
}

/** 초안 삭제. approved 는 조건에서 걸러져 삭제되지 않는다. */
export async function deleteDraft(documentId: string, id: string): Promise<boolean> {
  const { data, error } = await createServerClient().from("faq").delete().eq("id", id).eq("source_doc_id", documentId).eq("status", "draft").select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
