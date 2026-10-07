"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { createAuthClient } from "@/lib/db/auth";
import {
  bulkApprove,
  deleteDraftFaq,
  deleteDraftFaqs,
  insertFaqAdmin,
  syncApproval,
  updateFaqAdmin,
  validateFaqInput,
  type FaqInput,
} from "@/lib/db/admin-faq";
import { setUnansweredResolved } from "@/lib/db/admin-unanswered";
import { applyFaqSource, approveFaqAdmin, confirmFaqReview, findLatestVersion, verifyEvidenceInDoc } from "@/lib/db/admin-faq-review";
import { getFaq } from "@/lib/db/admin-faq";
import { invalidateFaqCache } from "@/lib/search";
import type { FaqCategory, FaqStatus } from "@/lib/db/types";

export interface SaveState {
  error?: string;
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** returnTo 는 /admin 안쪽 경로만 허용한다 (오픈 리다이렉트 방지). */
const safeReturn = (v: string, fallback: string) => (v.startsWith("/admin") && !v.startsWith("//") ? v : fallback);

export async function logoutAction() {
  const supabase = await createAuthClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

/** FAQ 등록/수정. 저장 후 챗봇이 쓰는 FAQ 캐시를 무효화한다. */
export async function saveFaqAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const { email } = await requireAdmin();

  const id = str(formData.get("id")); // "new" 이면 등록
  const input: FaqInput = {
    question: str(formData.get("question")),
    variants: str(formData.get("variants")).split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
    answer: str(formData.get("answer")),
    cert_type: str(formData.get("cert_type")),
    category: str(formData.get("category")) as FaqCategory,
    source_url: str(formData.get("source_url")).trim() || null,
    // [수정 후 승인] 버튼(intent=approve)이면 이 저장으로 바로 승인한다
    status: (str(formData.get("intent")) === "approve" ? "approved" : str(formData.get("status"))) as FaqStatus,
    needs_input: formData.get("needs_input") === "on",
  };
  const problem = validateFaqInput(input);
  if (problem) return { error: problem };

  try {
    if (id === "new") {
      const created = await insertFaqAdmin(input);
      await syncApproval(created.id, null, input.status, email); // 승인 상태로 바로 등록했다면 승인자를 남긴다
    } else {
      const prev = await getFaq(id);
      await updateFaqAdmin(id, input);
      await syncApproval(id, prev?.status ?? null, input.status, email);

      // 새 문서로 다시 만든 초안을 채워서 저장한 경우: 출처를 새 문서로 옮긴다 (근거 문장이 그 문서에 실제로 있어야 함)
      const applyDoc = str(formData.get("apply_doc_id"));
      if (applyDoc) {
        let evidence: string[] = [];
        try {
          const parsed = JSON.parse(str(formData.get("apply_evidence")) || "[]");
          evidence = Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
        } catch {
          evidence = [];
        }
        if (!(await verifyEvidenceInDoc(applyDoc, evidence))) return { error: "새 초안의 근거 문장을 문서 원문에서 확인하지 못했습니다. 새 초안을 다시 만들어 주세요." };
        const page = Number(str(formData.get("apply_page")));
        await applyFaqSource(id, { docId: applyDoc, page: Number.isFinite(page) && page > 0 ? page : null, evidence });
      }
      // 재검토 완료 (저장하면서 표시 해제). 새 문서로 출처를 옮기지 않았다면 최신 버전 문서로 연결해 다음 개정 때 다시 표시되게 한다.
      if (formData.get("clear_review") === "on") {
        const before = await getFaq(id);
        let relink: string | null = applyDoc || null;
        if (!relink && before?.source_doc_id) {
          const latest = await findLatestVersion(before.source_doc_id);
          relink = latest && latest.id !== before.source_doc_id && latest.status !== "archived" ? latest.id : null;
        }
        await confirmFaqReview(id, relink);
      }
    }
    // 미답변 질문에서 넘어온 등록이면 그 질문을 처리 완료로 표시
    const fromUnanswered = str(formData.get("unanswered"));
    if (id === "new" && fromUnanswered) await setUnansweredResolved(fromUnanswered, true);
  } catch (err) {
    console.error("[admin] FAQ 저장 실패:", err);
    return { error: "저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }

  invalidateFaqCache();
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  redirect(`${back}${back.includes("?") ? "&" : "?"}msg=saved`);
}

/**
 * [삭제]: 초안(draft) FAQ 를 지운다. 승인된 FAQ 는 삭제되지 않는다 (챗봇에서 내리려면 상태를 '초안'으로 바꿔 저장).
 * 삭제는 되돌릴 수 없으므로 화면에서 확인 창을 한 번 거친다.
 */
export async function deleteFaqAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  const sep = back.includes("?") ? "&" : "?";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) redirect(`${back}${sep}msg=error`);
  let res;
  try {
    res = await deleteDraftFaq(id);
  } catch (err) {
    console.error("[admin] FAQ 삭제 실패:", err);
    redirect(`${back}${sep}msg=error`);
  }
  if (!res.ok) redirect(`/admin/faq/${id}?err=${encodeURIComponent(res.reason === "approved" ? "승인된 FAQ는 삭제할 수 없습니다. 챗봇에서 내리려면 상태를 '초안'으로 바꿔 저장하세요." : "이미 삭제되었거나 찾을 수 없는 FAQ입니다.")}`);
  redirect(`${back}${sep}msg=deleted`);
}

/** [승인] 한 번: 검수 화면에서 status='approved' 로. 승인은 이 화면의 사람 클릭으로만 일어난다. */
export async function approveFaqAction(formData: FormData) {
  const { email } = await requireAdmin();
  const id = str(formData.get("id"));
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  const sep = back.includes("?") ? "&" : "?";
  let res;
  try {
    res = await approveFaqAdmin(id, email);
  } catch (err) {
    console.error("[admin] 승인 실패:", err);
    redirect(`${back}${sep}msg=error`);
  }
  if (!res.ok) redirect(`/admin/faq/${id}?err=${encodeURIComponent(res.error)}`);
  invalidateFaqCache();
  redirect(`${back}${sep}msg=approved_one`);
}

/** 재검토 완료 (변경 없음): 표시를 해제하고, 출처를 최신 버전 문서로 옮긴다. 답변·상태는 그대로. */
export async function confirmReviewAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  const sep = back.includes("?") ? "&" : "?";
  const faq = await getFaq(id);
  if (!faq) redirect(`${back}${sep}msg=error`);
  let relink: string | null = null;
  if (faq.source_doc_id) {
    const latest = await findLatestVersion(faq.source_doc_id);
    if (latest && latest.id !== faq.source_doc_id && latest.status !== "archived") relink = latest.id;
  }
  await confirmFaqReview(id, relink);
  invalidateFaqCache();
  redirect(`${back}${sep}msg=review_done`);
}

/** 선택한 FAQ 일괄 승인 (답변이 비었거나 보완 필요 표시가 있는 항목은 건너뜀). */
export async function bulkApproveAction(formData: FormData) {
  const { email } = await requireAdmin();
  const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string");
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  const sep = back.includes("?") ? "&" : "?";
  if (ids.length === 0) redirect(`${back}${sep}msg=none`);

  let result;
  try {
    result = await bulkApprove(ids, email);
  } catch (err) {
    console.error("[admin] 일괄 승인 실패:", err);
    redirect(`${back}${sep}msg=error`);
  }
  invalidateFaqCache();
  redirect(`${back}${sep}msg=approved&ok=${result.approved}&skip=${result.skipped}`);
}

/** 선택한 초안 FAQ 일괄 삭제. 승인된 FAQ 는 건너뛴다. 되돌릴 수 없으므로 화면에서 확인 창을 거친다. */
export async function bulkDeleteAction(formData: FormData) {
  await requireAdmin();
  const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string");
  const back = safeReturn(str(formData.get("returnTo")), "/admin/faq");
  const sep = back.includes("?") ? "&" : "?";
  if (ids.length === 0) redirect(`${back}${sep}msg=none_delete`);

  let result;
  try {
    result = await deleteDraftFaqs(ids);
  } catch (err) {
    console.error("[admin] FAQ 일괄 삭제 실패:", err);
    redirect(`${back}${sep}msg=error`);
  }
  invalidateFaqCache();
  redirect(`${back}${sep}msg=bulk_deleted&ok=${result.deleted}&skip=${result.skipped}`);
}

export async function resolveUnansweredAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const resolved = str(formData.get("resolved")) !== "false";
  if (id) await setUnansweredResolved(id, resolved);
  redirect(safeReturn(str(formData.get("returnTo")), "/admin/unanswered"));
}
