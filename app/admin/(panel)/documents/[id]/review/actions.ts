"use server";

import { requireAdmin } from "@/lib/admin/guard";
import { hasCertName } from "@/lib/cert-names";
import { ensureCertNames } from "@/lib/cert-registry";
import { approveEdits, deleteDraft, getReviewRows, setHold } from "@/lib/db/admin-doc-review";
import { checkTouchable, planApproval, validateDraftEdit, type ReviewEdit } from "@/lib/docs/doc-review";
import { invalidateFaqCache } from "@/lib/search";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";

export type ItemResult = { id: string; ok: boolean; error?: string };

/**
 * [승인] / [일괄 승인] / [전체 승인]: 화면에 보이는 현재 질문·답변(수정본)을 저장하면서 승인한다.
 * 승인은 이 호출(사람이 누른 버튼)로만 일어난다. 승인 즉시 챗봇 검색 대상이 되므로 FAQ 캐시를 무효화한다.
 */
export async function reviewApproveAction(documentId: string, edits: ReviewEdit[]): Promise<{ results: ItemResult[]; approved: number }> {
  const { email } = await requireAdmin();
  await ensureCertNames();
  if (!UUID.test(documentId) || !Array.isArray(edits)) return { results: [], approved: 0 };
  const clean: ReviewEdit[] = edits
    .filter((e) => e && typeof e.id === "string" && UUID.test(e.id) && typeof e.question === "string" && typeof e.answer === "string" && typeof e.cert_type === "string" && typeof e.category === "string")
    .map((e) => ({ id: e.id, question: e.question, answer: e.answer, cert_type: e.cert_type, category: e.category }));
  // 등록되지 않은 인증 종류로는 저장하지 않는다 (카드의 선택지는 등록된 인증 종류만 보여준다)
  const unknownCert = new Set(clean.filter((e) => !hasCertName(e.cert_type)).map((e) => e.id));
  try {
    const plan = planApproval(clean.filter((e) => !unknownCert.has(e.id)), await getReviewRows(clean.map((e) => e.id)), documentId);
    const approvedIds = new Set(await approveEdits(documentId, plan.approve, email));
    if (approvedIds.size > 0) invalidateFaqCache();
    const results: ItemResult[] = [
      ...plan.approve.map((e) => (approvedIds.has(e.id) ? { id: e.id, ok: true } : { id: e.id, ok: false, error: "상태가 바뀌어 승인하지 못했습니다. 새로고침해 주세요." })),
      ...plan.failed.map((f) => ({ id: f.id, ok: false, error: f.error })),
      ...[...unknownCert].map((id) => ({ id, ok: false, error: "등록되지 않은 인증 종류입니다. 인증 종류를 다시 선택해 주세요." })),
    ];
    return { results, approved: approvedIds.size };
  } catch (err) {
    console.error("[doc-review] 승인 실패:", err);
    return { results: clean.map((e) => ({ id: e.id, ok: false, error: GENERIC_ERROR })), approved: 0 };
  }
}

/** [보류] / 보류 해제. 수정본이 있으면 함께 저장한다. 초안(draft) 상태는 그대로다. */
export async function reviewHoldAction(documentId: string, id: string, hold: boolean, edit?: { question: string; answer: string; cert_type: string; category: string }): Promise<ItemResult> {
  await requireAdmin();
  await ensureCertNames();
  if (!UUID.test(documentId) || !UUID.test(id)) return { id, ok: false, error: "FAQ를 찾을 수 없습니다." };
  try {
    const [row] = await getReviewRows([id]);
    const blocked = checkTouchable(row, documentId);
    if (blocked) return { id, ok: false, error: blocked };
    if (edit) {
      const problem = validateDraftEdit(edit) ?? (hasCertName(edit.cert_type) ? null : "등록되지 않은 인증 종류입니다.");
      if (problem) return { id, ok: false, error: problem };
    }
    const ok = await setHold(documentId, id, hold, edit);
    return ok ? { id, ok: true } : { id, ok: false, error: "상태가 바뀌어 처리하지 못했습니다. 새로고침해 주세요." };
  } catch (err) {
    console.error("[doc-review] 보류 실패:", err);
    return { id, ok: false, error: err instanceof Error && err.message.includes("0008") ? err.message : GENERIC_ERROR };
  }
}

/** [삭제]: 이 문서의 초안만 삭제한다. 승인된 FAQ는 삭제되지 않는다. */
export async function reviewDeleteAction(documentId: string, id: string): Promise<ItemResult> {
  await requireAdmin();
  if (!UUID.test(documentId) || !UUID.test(id)) return { id, ok: false, error: "FAQ를 찾을 수 없습니다." };
  try {
    const [row] = await getReviewRows([id]);
    const blocked = checkTouchable(row, documentId);
    if (blocked) return { id, ok: false, error: blocked };
    return (await deleteDraft(documentId, id)) ? { id, ok: true } : { id, ok: false, error: "상태가 바뀌어 삭제하지 못했습니다. 새로고침해 주세요." };
  } catch (err) {
    console.error("[doc-review] 삭제 실패:", err);
    return { id, ok: false, error: GENERIC_ERROR };
  }
}
