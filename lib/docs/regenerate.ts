import "server-only";
import { findLatestVersion } from "@/lib/db/admin-faq-review";
import { listCandidateDocs } from "@/lib/db/admin-doc-search";
import type { Faq } from "@/lib/db/types";
import { draftFromDocs, type DraftDeps, type DraftOutcome } from "./draft";
import { defaultDraftDeps } from "./default-deps";

export interface RegenerateResult {
  outcome: DraftOutcome;
  /** 어떤 문서 범위로 다시 만들었는지 (화면 안내용) */
  scope: string;
}

/**
 * 재검토가 필요한 FAQ 의 질문으로, 새 문서에서 초안을 다시 만든다 (기존 FAQ 는 바꾸지 않고 비교용 결과만 돌려준다).
 *  - 출처 문서가 개정됨(revised): 새 버전 문서 하나만 대상으로 한다 (텍스트 추출이 끝난 경우)
 *  - 출처 문서가 삭제됨(deleted) / 출처 없음: 지금 추출된 문서 전체에서 찾는다 (인증 종류 우선)
 */
export async function regenerateForFaq(faq: Faq, deps: DraftDeps = defaultDraftDeps): Promise<RegenerateResult> {
  const cert = faq.cert_type && faq.cert_type !== "common" ? faq.cert_type : undefined;

  if (faq.review_reason === "revised" && faq.source_doc_id) {
    const latest = await findLatestVersion(faq.source_doc_id);
    if (latest && latest.id !== faq.source_doc_id) {
      if (latest.status !== "extracted") {
        return {
          outcome: { status: "no_docs", reason: `새 버전 문서('${latest.file_name}')의 텍스트 추출이 끝나지 않았습니다. 문서 보관함에서 '추출 완료'가 된 뒤 다시 시도해 주세요.` },
          scope: `새 버전 문서: ${latest.file_name} (v${latest.version})`,
        };
      }
      const only: DraftDeps = { ...deps, loadDocs: async () => (await listCandidateDocs()).filter((d) => d.id === latest.id) };
      return { outcome: await draftFromDocs(faq.question, cert, only), scope: `새 버전 문서: ${latest.file_name} (v${latest.version})` };
    }
  }
  return { outcome: await draftFromDocs(faq.question, cert, deps), scope: "지금 추출이 끝난 문서 전체" };
}
