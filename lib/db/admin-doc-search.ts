import "server-only";
import { createServerClient } from "./server";
import type { DocChunk, DocInfo } from "@/lib/docs/draft";

const CHUNK_PAGE = 1000; // PostgREST 기본 최대 응답 행 수
const MAX_SECTIONS = 12;
const PREVIEW_CHARS = 200;

/**
 * 초안 작성 후보 문서: status='extracted' (archived·failed·pending 제외).
 * doc_category='other'(기타) 문서는 제외한다: 인증 근거 자료(절차·비용·양식·규정)로 분류된 문서만 초안의 재료가 된다.
 *  (예: 챗봇 시스템 매뉴얼 같은 내부 문서가 FAQ 답변의 근거로 끌려오는 것을 막는다)
 * 인증 종류 우선순위는 호출측(prioritizeDocs)에서 처리한다.
 */
export async function listCandidateDocs(): Promise<DocInfo[]> {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("documents")
    .select("id, file_name, cert_type, doc_category")
    .eq("status", "extracted")
    .neq("doc_category", "other")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const docs = (data ?? []) as Omit<DocInfo, "sections">[];
  if (docs.length === 0) return [];

  // 문서 고르기용 섹션 제목 (문서당 최대 12개)
  const sections = new Map<string, string[]>();
  const ids = docs.map((d) => d.id);
  for (let from = 0; ; from += CHUNK_PAGE) {
    const { data: rows, error: e2 } = await sb
      .from("doc_chunks")
      .select("document_id, section_title")
      .in("document_id", ids)
      .not("section_title", "is", null)
      .order("document_id")
      .order("chunk_index")
      .range(from, from + CHUNK_PAGE - 1);
    if (e2) throw e2;
    for (const r of rows ?? []) {
      const list = sections.get(r.document_id as string) ?? [];
      const t = String(r.section_title);
      if (!list.includes(t) && list.length < MAX_SECTIONS) list.push(t);
      sections.set(r.document_id as string, list);
    }
    if ((rows?.length ?? 0) < CHUNK_PAGE) break;
  }
  // 문서 첫머리 미리보기: 파일명·섹션 제목만으로는 내용을 알기 어려운 문서(제목이 없는 PDF 등)를 놓치지 않게 한다
  const previews = new Map<string, string>();
  const { data: firsts, error: e3 } = await sb.from("doc_chunks").select("document_id, content").in("document_id", ids).eq("chunk_index", 0);
  if (e3) throw e3;
  for (const r of firsts ?? []) previews.set(r.document_id as string, String(r.content).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS));
  return docs.map((d) => ({ ...d, sections: sections.get(d.id) ?? [], preview: previews.get(d.id) }));
}

/** 선택된 문서의 조각 전체 (문서·조각 순서대로) */
export async function loadDocChunks(documentIds: string[]): Promise<DocChunk[]> {
  if (documentIds.length === 0) return [];
  const sb = createServerClient();
  const out: DocChunk[] = [];
  for (let from = 0; ; from += CHUNK_PAGE) {
    const { data, error } = await sb
      .from("doc_chunks")
      .select("id, document_id, chunk_index, content, page_no, section_title")
      .in("document_id", documentIds)
      .order("document_id")
      .order("chunk_index")
      .range(from, from + CHUNK_PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as DocChunk[]));
    if ((data?.length ?? 0) < CHUNK_PAGE) break;
  }
  return out;
}
