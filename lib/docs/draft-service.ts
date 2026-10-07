import "server-only";
import { hasCertName } from "@/lib/cert-names";
import { ensureCertNames } from "@/lib/cert-registry";
import { findDraftsForUnanswered, insertAutoDraftFaq } from "@/lib/db/admin-doc-draft";
import { getUnansweredAdmin } from "@/lib/db/admin-unanswered";
import { draftFromDocs, type DraftDeps, type DraftSource } from "./draft";
import { defaultDraftDeps } from "./default-deps";

export type DraftRunStatus = "drafted" | "not_found" | "rejected" | "no_docs" | "blocked" | "exists" | "missing" | "error";

export interface DraftRunResult {
  unansweredId: string;
  status: DraftRunStatus;
  faqId?: string;
  reason?: string;
  /** drafted 일 때 근거로 쓴 문서·페이지 */
  sources?: DraftSource[];
}

/**
 * 미답변 질문 하나에 대해 문서에서 초안을 만들어 faq 에 draft 로 저장한다.
 *  - 근거가 있으면: 답변 + 출처 문서·페이지 + 근거 원문이 채워진 초안
 *  - 근거를 못 찾거나 검증에서 폐기되면: 빈 답변 + needs_input=true 로 생성 (담당자가 채운다)
 *  - 이미 이 질문에서 만든 초안이 있으면 만들지 않는다
 * 항상 status='draft' 이다. 실패해도 예외를 던지지 않고 결과로 돌려준다.
 */
export async function draftForUnanswered(unansweredId: string, certType?: string, deps: DraftDeps = defaultDraftDeps): Promise<DraftRunResult> {
  try {
    await ensureCertNames();
    const row = await getUnansweredAdmin(unansweredId);
    if (!row) return { unansweredId, status: "missing", reason: "미답변 질문을 찾을 수 없습니다." };

    const existing = (await findDraftsForUnanswered([unansweredId])).get(unansweredId);
    if (existing) return { unansweredId, status: "exists", faqId: existing.id, reason: "이미 초안이 있습니다." };

    const pickedCert = certType && hasCertName(certType) && certType !== "common" ? certType : undefined;
    const out = await draftFromDocs(row.question, pickedCert, deps);

    let faqId: string;
    if (out.status === "drafted") {
      faqId = await insertAutoDraftFaq({
        question: row.question,
        answer: out.draft.answer,
        cert_type: pickedCert ?? out.docCertType ?? "common",
        category: out.category,
        source_doc_id: out.primary.document_id,
        source_page: out.primary.page_no,
        source_evidence: out.draft.evidence,
        source_unanswered_id: unansweredId,
        draft_note: `문서에서 초안을 만들었습니다 (신뢰도 ${out.draft.confidence}). 원문과 비교해 확인하세요.`,
      });
      return { unansweredId, status: "drafted", faqId, sources: out.draft.sources };
    }

    // 컨설팅·불만·범위 밖 질문은 FAQ 후보가 아니다: 초안을 만들지 않는다
    if (out.status === "blocked") return { unansweredId, status: "blocked", reason: out.reason };

    // 추출이 끝난 문서가 하나도 없으면 빈 초안을 만들지 않는다 (문서를 올리면 그때 다시 실행)
    if (out.status === "no_docs") return { unansweredId, status: "no_docs", reason: out.reason };

    faqId = await insertAutoDraftFaq({
      question: row.question,
      answer: "",
      cert_type: pickedCert ?? "common",
      category: out.category ?? "scope",
      source_doc_id: null,
      source_page: null,
      source_evidence: [],
      source_unanswered_id: unansweredId,
      draft_note: out.status === "rejected" ? `근거 검증에서 초안이 제외되었습니다: ${out.reason}` : out.reason,
    });
    return { unansweredId, status: out.status, faqId, reason: out.reason };
  } catch (err) {
    console.error("[doc-draft] 초안 작성 중 오류:", unansweredId, err);
    return { unansweredId, status: "error", reason: "초안을 만드는 중 오류가 발생했습니다." };
  }
}

/** 여러 건 순차(동시 2건) 실행. 비용을 예측할 수 있게 한 번에 최대 10건으로 제한한다. */
export const MAX_BULK_DRAFTS = 10;

export async function draftForUnansweredMany(ids: string[], certType?: string, deps: DraftDeps = defaultDraftDeps): Promise<DraftRunResult[]> {
  const targets = [...new Set(ids)].slice(0, MAX_BULK_DRAFTS);
  const results: DraftRunResult[] = new Array(targets.length);
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const i = next++;
      results[i] = await draftForUnanswered(targets[i], certType, deps);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
  return results;
}
