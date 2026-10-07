"use server";

import { requireAdmin } from "@/lib/admin/guard";
import { getFaq } from "@/lib/db/admin-faq";
import { regenerateForFaq } from "@/lib/docs/regenerate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RegenerateState =
  | { status: "idle" }
  | { status: "drafted"; scope: string; answer: string; evidence: string[]; sources: { file_name: string; page_no: number | null; document_id: string }[]; confidence: string; docId: string; page: number | null }
  | { status: "not_found" | "rejected" | "no_docs" | "blocked" | "error"; scope: string; reason: string };

/**
 * [새 문서로 초안 다시 만들기]: 이 FAQ 의 질문으로 새 문서에서 초안을 다시 만들어 기존 답변과 비교하게 한다.
 * 이 액션은 FAQ 를 수정하지 않는다 (결과만 돌려준다). 적용은 사람이 검토한 뒤 저장 버튼으로만 한다.
 */
export async function regenerateDraftAction(_prev: RegenerateState, formData: FormData): Promise<RegenerateState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { status: "error", scope: "", reason: "FAQ를 찾을 수 없습니다." };
  try {
    const faq = await getFaq(id);
    if (!faq) return { status: "error", scope: "", reason: "FAQ를 찾을 수 없습니다." };
    const { outcome, scope } = await regenerateForFaq(faq);
    if (outcome.status === "drafted") {
      return {
        status: "drafted",
        scope,
        answer: outcome.draft.answer,
        evidence: outcome.draft.evidence,
        sources: outcome.draft.sources,
        confidence: outcome.draft.confidence,
        docId: outcome.primary.document_id,
        page: outcome.primary.page_no,
      };
    }
    return { status: outcome.status, scope, reason: outcome.reason };
  } catch (err) {
    console.error("[admin] 초안 다시 만들기 실패:", err);
    return { status: "error", scope: "", reason: "초안을 만드는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
