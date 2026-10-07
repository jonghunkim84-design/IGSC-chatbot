import "server-only";
import { createServerClient } from "./server";
import { DOC_BUCKET, getDocument } from "./admin-documents";
import { EXTRACT_MESSAGES, ExtractError, extractWithMetrics } from "@/lib/extract";
import { extensionOf } from "@/lib/admin/documents";

export type ExtractOutcome = { ok: true; chunks: number } | { ok: false; reason: string; recorded: boolean };

const GENERIC_REASON = "텍스트를 추출하는 중 오류가 발생했습니다. 다시 시도해 주세요. 계속되면 개발사에 문의해 주세요.";

/** 추출 실패를 documents 에 기록한다 (조각 삭제 + status='failed' + 사유). 기록 자체가 실패하면 false. */
async function recordFailure(documentId: string, reason: string): Promise<boolean> {
  const { error } = await createServerClient().rpc("fail_doc_extraction", { p_document_id: documentId, p_reason: reason });
  if (error) {
    console.error("[extract] 실패 기록 오류:", documentId, error);
    return false;
  }
  return true;
}

/**
 * 문서 하나의 텍스트를 추출해 doc_chunks 에 저장한다.
 * - 성공: 기존 조각을 지우고 새 조각 저장 + status='extracted' (한 트랜잭션, 중복 없음)
 * - 실패: 조각 삭제 + status='failed' + 사유. 업로드된 파일과 문서 정보는 그대로 유지된다.
 * - 이전 버전(archived) 문서는 건드리지 않는다.
 * 예외를 던지지 않는다 (백그라운드 실행에서 업로드에 영향을 주지 않도록).
 */
export async function runExtraction(documentId: string): Promise<ExtractOutcome> {
  const sb = createServerClient();
  try {
    const doc = await getDocument(documentId);
    if (!doc) return { ok: false, reason: "문서를 찾을 수 없습니다.", recorded: false };
    if (doc.status === "archived") return { ok: false, reason: "이전 버전 문서는 추출하지 않습니다.", recorded: false };

    const { data: blob, error: dlErr } = await sb.storage.from(DOC_BUCKET).download(doc.storage_path);
    if (dlErr || !blob) {
      console.error("[extract] 파일 내려받기 실패:", doc.storage_path, dlErr);
      const reason = "저장된 파일을 읽지 못했습니다. 다시 시도하거나 파일을 다시 올려주세요.";
      return { ok: false, reason, recorded: await recordFailure(documentId, reason) };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());

    let chunks;
    let metrics;
    try {
      ({ chunks, metrics } = await extractWithMetrics(bytes, extensionOf(doc.storage_path)));
    } catch (e) {
      const reason = e instanceof ExtractError ? e.message : GENERIC_REASON;
      if (!(e instanceof ExtractError)) console.error("[extract] 예기치 않은 오류:", documentId, e);
      return { ok: false, reason, recorded: await recordFailure(documentId, reason) };
    }

    const { data, error } = await sb.rpc("finish_doc_extraction", { p_document_id: documentId, p_chunks: chunks });
    if (error) {
      console.error("[extract] 조각 저장 오류:", documentId, error);
      return { ok: false, reason: GENERIC_REASON, recorded: await recordFailure(documentId, GENERIC_REASON) };
    }
    // 추출 품질 지표 기록 (PDF: 페이지 수, PPTX: 슬라이드 수). 기록 실패는 추출 성공에 영향을 주지 않는다.
    const pageCount = metrics.pages ?? (chunks.some((c) => c.page_no !== null) ? Math.max(...chunks.map((c) => c.page_no ?? 0)) : null);
    const { error: mErr } = await sb.from("documents").update({ extracted_chars: metrics.chars, page_count: pageCount }).eq("id", documentId);
    if (mErr) console.error("[extract] 품질 지표 기록 실패:", documentId, mErr.message);
    return { ok: true, chunks: Number(data ?? chunks.length) };
  } catch (e) {
    console.error("[extract] 처리 중 오류:", documentId, e);
    return { ok: false, reason: GENERIC_REASON, recorded: await recordFailure(documentId, GENERIC_REASON).catch(() => false) };
  }
}

/** 여러 문서를 순서대로 추출 (한 번에 CPU 를 독점하지 않도록 순차 실행) */
export async function runExtractions(documentIds: string[]): Promise<void> {
  for (const id of documentIds) await runExtraction(id);
}

/** 추출 대기(pending) 중인 최신 문서 id (이전 버전 제외) */
export async function listPendingDocumentIds(limit = 10): Promise<string[]> {
  const { data, error } = await createServerClient()
    .from("documents")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export { EXTRACT_MESSAGES };
