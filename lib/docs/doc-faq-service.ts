import "server-only";
import { ensureCertNames } from "@/lib/cert-registry";
import { getDocument } from "@/lib/db/admin-documents";
import {
  cancelRunningJobs,
  claimChunks,
  createJob,
  deleteDraftFaqs,
  failJob,
  getJob,
  insertDocDraftFaqs,
  listAllFaqQuestions,
  listDocChunks,
  listDraftsOfDocument,
  recordProgress,
} from "@/lib/db/admin-doc-faq";
import type { DocFaqJob } from "@/lib/db/types";
import { CHUNKS_PER_REQUEST, QA_PAIRS_PER_REQUEST } from "@/lib/ingest/config";
import { applyDraftCap, checkDocumentForFaq, classifyReplaceable, processChunks, processQaPairs, type DocFaqDeps } from "./doc-faq";
import { defaultDocFaqDeps } from "./doc-faq-deps";
import { loadQaPairs } from "./qa-source";

/** 한 번의 요청(최대 60초)에서 처리하는 청크 수 (lib/ingest/config.ts). 진행 상태는 generation_jobs 에 저장된다. */
export const CHUNKS_PER_STEP = CHUNKS_PER_REQUEST;

export type StartResult = { ok: true; job: DocFaqJob } | { ok: false; error: string };
export type StepResult = { ok: true; job: DocFaqJob; createdNow: number; rejectedNow: number; busy?: boolean } | { ok: false; error: string };

/**
 * 문서 하나의 FAQ 초안 생성 작업을 시작한다.
 *  - 대상 문서 확인 (추출 완료 · 최신 버전 · 분류가 '기타'가 아님 · 질문·답변 문서는 형식 확인을 마침)
 *  - 재실행이면 이전 자동 초안을 교체한다: 수정했거나 미답변에서 만든 초안, 승인된 FAQ 는 지우지 않는다.
 * 처리 단위(total_chunks): 설명 자료는 청크 수, 질문·답변 문서는 쌍의 수.
 */
export async function startDocFaqJob(documentId: string, startedBy: string): Promise<StartResult> {
  await ensureCertNames();
  const doc = await getDocument(documentId);
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다." };
  const check = checkDocumentForFaq(doc);
  if (!check.ok) return { ok: false, error: check.reason };

  let total: number;
  if (doc.doc_format === "qa_pairs") {
    total = (await loadQaPairs(doc)).length;
    if (total === 0) return { ok: false, error: "질문·답변 쌍을 찾지 못했습니다. 문서 형식을 '설명 자료'로 바꾸거나 Q:/A: 또는 2열 표 형식인지 확인해 주세요." };
  } else {
    total = (await listDocChunks(documentId)).length;
    if (total === 0) return { ok: false, error: "추출된 텍스트 조각이 없습니다. 이미지 위주의 문서일 수 있습니다. 원본(PPTX 등)을 올려 주세요." };
  }

  await cancelRunningJobs(documentId);
  const { replace, protect } = classifyReplaceable(await listDraftsOfDocument(documentId));
  const replaced = await deleteDraftFaqs(replace);
  const job = await createJob({ documentId, total, replaced, protectedCount: protect.length, startedBy });
  return { ok: true, job };
}

/**
 * 다음 배치(설명 자료 5청크, 질문·답변 문서 10쌍)를 처리하고 진행 상태를 저장한다. 화면이 끝날 때까지 반복 호출한다.
 * 요청이 중간에 끊겨도 done_chunks 는 그대로이므로 같은 위치부터 다시 이어서 할 수 있다.
 * 후보가 파일당 상한(MAX_DRAFTS_PER_DOCUMENT)에 도달하면 중단하고 limit_reached 로 표시한다.
 */
export async function stepDocFaqJob(jobId: string, deps: DocFaqDeps = defaultDocFaqDeps): Promise<StepResult> {
  await ensureCertNames();
  const job = await getJob(jobId);
  if (!job) return { ok: false, error: "작업을 찾을 수 없습니다." };
  if (job.status !== "running") return { ok: true, job, createdNow: 0, rejectedNow: 0 };

  const fail = async (message: string): Promise<StepResult> => {
    await failJob(jobId, message).catch(() => {});
    return { ok: false, error: message };
  };

  try {
    const doc = await getDocument(job.document_id);
    if (!doc) return await fail("문서를 찾을 수 없습니다.");
    const check = checkDocumentForFaq(doc);
    if (!check.ok) return await fail(check.reason);

    const qa = doc.doc_format === "qa_pairs";
    const items = qa ? await loadQaPairs(doc) : await listDocChunks(job.document_id);
    if (items.length !== job.total_chunks) return await fail("작업 중 문서 내용이 바뀌었습니다. 다시 시작하세요.");

    const from = job.done_chunks;
    const to = Math.min(from + (qa ? QA_PAIRS_PER_REQUEST : CHUNKS_PER_STEP), job.total_chunks);
    if (!(await claimChunks(jobId, from))) return { ok: true, job: (await getJob(jobId)) ?? job, createdNow: 0, rejectedNow: 0, busy: true };

    const existing = await listAllFaqQuestions();
    const out = qa
      ? await processQaPairs((items as Awaited<ReturnType<typeof loadQaPairs>>).slice(from, to), doc, existing, deps)
      : await processChunks((items as Awaited<ReturnType<typeof listDocChunks>>).slice(from, to), doc, existing, deps);

    // 파일당 상한: 넘치는 후보는 저장하지 않고 탈락 목록에 남겨 담당자가 직접 작성할 수 있게 한다.
    const { keep, cut, limitReached } = applyDraftCap(job.created_count, out.drafts, to, job.total_chunks);

    await insertDocDraftFaqs(keep);
    const updated = await recordProgress(jobId, from, to, { created: keep.length, rejected: [...out.rejected, ...cut] }, { limitReached });
    return { ok: true, job: updated, createdNow: keep.length, rejectedNow: out.rejected.length + cut.length };
  } catch (err) {
    console.error("[doc-faq] 작업 처리 실패:", err);
    return fail("처리 중 오류가 발생했습니다. 잠시 후 '다시 만들기'로 재시도해 주세요.");
  }
}
