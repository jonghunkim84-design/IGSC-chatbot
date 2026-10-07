import "server-only";
import { createServerClient } from "./server";
import type { DocFaqJob, DocFaqRejected } from "./types";
import type { DocFaqDraft, ExistingQuestion, FaqChunk, ReplaceRow } from "@/lib/docs/doc-faq";
import { AUTO_NOTE_PREFIX } from "@/lib/docs/doc-faq";

/** 문서의 추출 조각(청크)을 순서대로 */
export async function listDocChunks(documentId: string): Promise<FaqChunk[]> {
  const { data, error } = await createServerClient()
    .from("doc_chunks")
    .select("page_no, section_title, content")
    .eq("document_id", documentId)
    .order("chunk_index");
  if (error) throw error;
  return (data ?? []) as FaqChunk[];
}

/** 중복 검사용: 기존 FAQ 질문 전체 (승인·초안 모두) */
export async function listAllFaqQuestions(): Promise<ExistingQuestion[]> {
  const sb = createServerClient();
  const out: ExistingQuestion[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("faq").select("id, cert_type, question").order("created_at").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as ExistingQuestion[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** 이 문서를 출처로 하는 초안(draft)들 — 재실행 때 교체 대상을 가리는 용도 */
export async function listDraftsOfDocument(documentId: string): Promise<ReplaceRow[]> {
  const { data, error } = await createServerClient()
    .from("faq")
    .select("id, status, draft_note, source_unanswered_id, created_at, updated_at")
    .eq("source_doc_id", documentId)
    .eq("status", "draft");
  if (error) throw error;
  return (data ?? []) as ReplaceRow[];
}

/** 초안(draft)만 삭제한다. approved 는 조건에서 걸러져 삭제되지 않는다. */
export async function deleteDraftFaqs(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await createServerClient().from("faq").delete().in("id", ids).eq("status", "draft").select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** 일괄 초안 저장. status 는 항상 'draft' 로 고정한다 — 이 경로에서 approved 를 만들 수 없다. */
export async function insertDocDraftFaqs(drafts: DocFaqDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const { data, error } = await createServerClient()
    .from("faq")
    .insert(
      drafts.map((d) => ({
        question: d.question,
        variants: d.variants,
        answer: d.answer,
        cert_type: d.cert_type,
        category: d.category,
        source_url: null,
        lang: "ko",
        status: "draft" as const, // 고정. 승인은 사람만 한다.
        needs_input: d.needs_input,
        source_doc_id: d.source_doc_id,
        source_page: d.source_page,
        source_evidence: d.source_evidence,
        draft_note: d.draft_note,
      })),
    )
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ── 작업(job) ────────────────────────────────────────────────

const MAX_REJECTED_KEPT = 500;

export async function cancelRunningJobs(documentId: string): Promise<void> {
  const { error } = await createServerClient()
    .from("generation_jobs")
    .update({ status: "canceled", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("document_id", documentId)
    .eq("status", "running");
  if (error) throw error;
}

export async function createJob(i: { documentId: string; total: number; replaced: number; protectedCount: number; startedBy: string }): Promise<DocFaqJob> {
  const { data, error } = await createServerClient()
    .from("generation_jobs")
    .insert({
      document_id: i.documentId,
      total_chunks: i.total,
      replaced_count: i.replaced,
      protected_count: i.protectedCount,
      started_by: i.startedBy,
      status: i.total === 0 ? "done" : "running",
      finished_at: i.total === 0 ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DocFaqJob;
}

export async function getJob(jobId: string): Promise<DocFaqJob | null> {
  const { data, error } = await createServerClient().from("generation_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw error;
  return (data as DocFaqJob | null) ?? null;
}

const LOCK_MS = 90_000;

/**
 * 다음 청크 범위(done_chunks 부터)를 이 요청이 처리하도록 짧게 잠근다.
 * 다른 요청이 처리 중(잠금 유효)이면 false. 요청이 중간에 끊기면 잠금이 만료되어 done_chunks 부터 다시 처리된다.
 */
export async function claimChunks(jobId: string, from: number): Promise<boolean> {
  const sb = createServerClient();
  const now = new Date();
  const { data, error } = await sb
    .from("generation_jobs")
    .update({ lock_until: new Date(now.getTime() + LOCK_MS).toISOString(), updated_at: now.toISOString() })
    .eq("id", jobId)
    .eq("status", "running")
    .eq("done_chunks", from)
    .or(`lock_until.is.null,lock_until.lt.${now.toISOString()}`)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * 처리가 끝난 구간을 반영한다: done_chunks 를 to 로 올리고 결과를 누적하며 잠금을 푼다.
 * finished 이거나 모든 청크를 처리했으면 작업을 끝낸다 (limitReached: 파일당 상한 도달로 중단).
 */
export async function recordProgress(
  jobId: string,
  from: number,
  to: number,
  add: { created: number; rejected: DocFaqRejected[] },
  opts: { limitReached?: boolean } = {},
): Promise<DocFaqJob> {
  const sb = createServerClient();
  const job = await getJob(jobId);
  if (!job) throw new Error("작업을 찾을 수 없습니다.");
  const finished = opts.limitReached === true || to >= job.total_chunks;
  const { data, error } = await sb
    .from("generation_jobs")
    .update({
      done_chunks: to,
      created_count: job.created_count + add.created,
      rejected: [...(job.rejected ?? []), ...add.rejected].slice(0, MAX_REJECTED_KEPT),
      status: finished ? "done" : job.status,
      limit_reached: opts.limitReached === true ? true : job.limit_reached,
      finished_at: finished ? new Date().toISOString() : null,
      lock_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("done_chunks", from)
    .select("*")
    .single();
  if (error) throw error;
  return data as DocFaqJob;
}

export async function failJob(jobId: string, message: string): Promise<void> {
  const { error } = await createServerClient()
    .from("generation_jobs")
    .update({ status: "failed", error: message.slice(0, 300), finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

/** 문서별 가장 최근 작업 (목록 화면 요약용). 탈락 상세는 건수만 돌려준다. */
export async function latestJobsFor(documentIds: string[]): Promise<Map<string, Omit<DocFaqJob, "rejected"> & { rejected_count: number; error_count: number }>> {
  const out = new Map<string, Omit<DocFaqJob, "rejected"> & { rejected_count: number; error_count: number }>();
  if (documentIds.length === 0) return out;
  const { data, error } = await createServerClient()
    .from("generation_jobs")
    .select("*")
    .in("document_id", documentIds)
    .neq("status", "canceled")
    .order("started_at", { ascending: false });
  if (error) {
    // 마이그레이션(0010) 전에는 테이블이 없다: 목록 화면이 깨지지 않게 빈 결과로 처리하고 로그만 남긴다.
    console.error("[doc-faq] 작업 조회 실패(0010 마이그레이션 적용 여부 확인):", error.message);
    return out;
  }
  for (const row of (data ?? []) as DocFaqJob[]) {
    if (out.has(row.document_id)) continue;
    const { rejected, ...rest } = row;
    // error_count: '처리 실패'로 탈락한 항목 수 (다시 만들기로 재시도할 일이 남았는지 판단하는 데 쓴다)
    out.set(row.document_id, { ...rest, rejected_count: rejected?.length ?? 0, error_count: (rejected ?? []).filter((r) => r.stage === "error").length });
  }
  return out;
}

/** 문서별 '이 기능이 만든 자동 초안' 개수 (다시 만들기 표시용) */
export async function countAutoDrafts(documentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (documentIds.length === 0) return out;
  const { data, error } = await createServerClient()
    .from("faq")
    .select("source_doc_id")
    .in("source_doc_id", documentIds)
    .like("draft_note", `${AUTO_NOTE_PREFIX}%`);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.source_doc_id as string, (out.get(r.source_doc_id as string) ?? 0) + 1);
  return out;
}

/** 문서의 가장 최근 작업 전체(탈락 목록 포함). 취소된 작업은 제외한다. */
export async function getLatestJobFull(documentId: string): Promise<DocFaqJob | null> {
  const { data, error } = await createServerClient()
    .from("generation_jobs")
    .select("*")
    .eq("document_id", documentId)
    .neq("status", "canceled")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as DocFaqJob | null) ?? null;
}

/** 유사 FAQ 검사용: approved + draft 질문. certType 이 있으면 그 인증 종류만 (같은 질문이라도 인증 종류가 다르면 중복이 아니다). */
export async function listFaqQuestionsByCert(certType?: string): Promise<{ id: string; question: string; status: "draft" | "approved"; cert_type: string }[]> {
  const sb = createServerClient();
  const out: { id: string; question: string; status: "draft" | "approved"; cert_type: string }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("faq").select("id, question, status, cert_type");
    if (certType) q = q.eq("cert_type", certType);
    const { data, error } = await q.order("created_at").order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as typeof out));
    if (!data || data.length < 1000) break;
  }
  return out;
}
