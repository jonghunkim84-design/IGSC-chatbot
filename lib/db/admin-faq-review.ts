import "server-only";
import { approvalFields } from "./admin-faq";
import { createServerClient } from "./server";
import { getDocument } from "./admin-documents";
import { loadDocChunks } from "./admin-doc-search";
import type { DocumentRow, Faq } from "./types";
import { highlightSegments, type Segment } from "@/lib/docs/highlight";
import { norm } from "@/lib/ingest/evidence";

export interface SourceChunkView {
  id: string;
  chunk_index: number;
  page_no: number | null;
  section_title: string | null;
  /** 원문을 근거 문장 강조 구간으로 나눈 것 */
  segments: Segment[];
  hasEvidence: boolean;
}

export interface SourceView {
  doc: DocumentRow | null;
  /** 출처 문서가 개정된 경우 최신 버전 */
  latest: DocumentRow | null;
  chunks: SourceChunkView[];
  /** 원문에서 찾지 못한 근거 문장 (문서가 삭제되었거나 다시 추출되어 달라진 경우) */
  missingEvidence: string[];
}

/** documents.supersedes 를 따라가 가장 최신 버전을 찾는다 (자기 자신이 최신이면 자기 자신) */
export async function findLatestVersion(docId: string): Promise<DocumentRow | null> {
  const sb = createServerClient();
  let current = await getDocument(docId);
  for (let hop = 0; current && hop < 30; hop++) {
    const { data, error } = await sb.from("documents").select("*").eq("supersedes", current.id).order("version", { ascending: false }).limit(1);
    if (error) throw error;
    if (!data || data.length === 0) return current;
    current = data[0] as DocumentRow;
  }
  return current;
}

/**
 * FAQ 의 출처 카드용 데이터: 출처 문서, 근거 문장이 들어 있는 원문 조각(강조 구간 포함).
 * 근거가 있는 조각이 없으면 출처 페이지의 조각을 보여준다.
 */
export async function getSourceView(faq: Faq): Promise<SourceView> {
  if (!faq.source_doc_id) return { doc: null, latest: null, chunks: [], missingEvidence: faq.source_evidence ?? [] };
  const doc = await getDocument(faq.source_doc_id);
  if (!doc) return { doc: null, latest: null, chunks: [], missingEvidence: faq.source_evidence ?? [] };

  const all = await loadDocChunks([doc.id]);
  const quotes = faq.source_evidence ?? [];
  const found = new Set<string>();
  const views: SourceChunkView[] = [];
  for (const c of all) {
    const segs = highlightSegments(c.content, quotes);
    const has = segs.some((s) => s.mark);
    if (has) {
      for (const q of quotes) if (norm(c.content).includes(norm(q))) found.add(q);
      views.push({ id: c.id, chunk_index: c.chunk_index, page_no: c.page_no, section_title: c.section_title, segments: segs, hasEvidence: true });
    }
  }
  if (views.length === 0 && faq.source_page !== null) {
    for (const c of all.filter((x) => x.page_no === faq.source_page)) {
      views.push({ id: c.id, chunk_index: c.chunk_index, page_no: c.page_no, section_title: c.section_title, segments: [{ text: c.content, mark: false }], hasEvidence: false });
    }
  }
  const latest = doc.status === "archived" ? await findLatestVersion(doc.id) : null;
  return { doc, latest: latest && latest.id !== doc.id ? latest : null, chunks: views, missingEvidence: quotes.filter((q) => !found.has(q)) };
}

/** [승인] 한 번: status='approved'. 답변이 비었거나 '담당자 입력 필요'면 승인하지 않는다. */
export async function approveFaqAdmin(id: string, approver: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = createServerClient();
  const { data, error } = await sb.from("faq").select("answer, needs_input, status").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "FAQ를 찾을 수 없습니다." };
  if (data.needs_input) return { ok: false, error: "'담당자 입력 필요' 표시가 있는 항목은 승인할 수 없습니다. 답변을 채운 뒤 표시를 해제해 주세요." };
  if (!String(data.answer).trim()) return { ok: false, error: "답변이 비어 있는 항목은 승인할 수 없습니다." };
  if (data.status === "approved") return { ok: true }; // 이미 승인됨: 처음 승인한 기록을 그대로 둔다
  const { error: e2 } = await sb.from("faq").update({ status: "approved", ...approvalFields(approver) }).eq("id", id);
  if (e2) throw e2;
  return { ok: true };
}

/**
 * 재검토 완료: needs_review=false 로 되돌린다 (status 와 답변은 그대로).
 * relinkTo 가 있으면 출처를 그 문서(새 버전)로 옮긴다 — 다음 개정 때 다시 표시가 붙도록. 페이지는 알 수 없으므로 비운다.
 */
export async function confirmFaqReview(id: string, relinkTo?: string | null): Promise<void> {
  const patch: Record<string, unknown> = { needs_review: false, review_reason: null, review_note: null, review_flagged_at: null };
  if (relinkTo) {
    patch.source_doc_id = relinkTo;
    patch.source_page = null;
  }
  const { error } = await createServerClient().from("faq").update(patch).eq("id", id);
  if (error) throw error;
}

/** 새 문서 기반으로 출처를 바꾼다 (검수 화면에서 새 초안을 채워 저장할 때). 근거 문장이 그 문서에 실제로 있는지 다시 확인한다. */
export async function verifyEvidenceInDoc(docId: string, evidence: string[]): Promise<boolean> {
  if (evidence.length === 0) return false;
  const chunks = await loadDocChunks([docId]);
  const text = norm(chunks.map((c) => c.content).join("\n"));
  return evidence.every((e) => norm(e).length >= 6 && text.includes(norm(e)));
}

export async function countNeedsReview(): Promise<number> {
  const { count, error } = await createServerClient().from("faq").select("id", { count: "exact", head: true }).eq("needs_review", true).eq("status", "approved");
  if (error) throw error;
  return count ?? 0;
}

/** 새 문서 기반으로 출처를 바꾼다. 호출 전에 verifyEvidenceInDoc 으로 근거 문장이 그 문서에 실제로 있는지 확인해야 한다. */
export async function applyFaqSource(id: string, src: { docId: string; page: number | null; evidence: string[] }): Promise<void> {
  const { error } = await createServerClient()
    .from("faq")
    .update({ source_doc_id: src.docId, source_page: src.page, source_evidence: src.evidence })
    .eq("id", id);
  if (error) throw error;
}
