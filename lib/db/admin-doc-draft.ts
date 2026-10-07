import "server-only";
import { createServerClient } from "./server";
import type { FaqCategory } from "./types";

export interface DraftFaqInsert {
  question: string;
  answer: string;
  cert_type: string;
  category: FaqCategory;
  source_doc_id: string | null;
  source_page: number | null;
  source_evidence: string[];
  source_unanswered_id: string;
  /** 자동 초안 결과 메모 (근거 없음·검증 탈락 사유 등) */
  draft_note?: string | null;
}

export interface ExistingDraft {
  id: string;
  status: string;
  needs_input: boolean;
  source_unanswered_id: string;
  draft_note: string | null;
}

/** 미답변 질문에서 이미 만든 초안 (질문당 하나) */
export async function findDraftsForUnanswered(unansweredIds: string[]): Promise<Map<string, ExistingDraft>> {
  const out = new Map<string, ExistingDraft>();
  if (unansweredIds.length === 0) return out;
  const { data, error } = await createServerClient()
    .from("faq")
    .select("id, status, needs_input, source_unanswered_id, draft_note")
    .in("source_unanswered_id", unansweredIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  for (const r of (data ?? []) as ExistingDraft[]) if (!out.has(r.source_unanswered_id)) out.set(r.source_unanswered_id, r);
  return out;
}

/**
 * 자동 초안 저장. status 는 항상 'draft' 로 고정한다 — 이 경로에서 approved 를 만들 수 없다.
 * 답변이 비어 있으면(근거 없음) needs_input=true 로 저장한다.
 */
export async function insertAutoDraftFaq(i: DraftFaqInsert): Promise<string> {
  const empty = i.answer.trim() === "";
  const { data, error } = await createServerClient()
    .from("faq")
    .insert({
      question: i.question.trim(),
      variants: [],
      answer: i.answer.trim(),
      cert_type: i.cert_type,
      category: i.category,
      source_url: null,
      lang: "ko",
      status: "draft", // 고정. 승인은 사람만 한다.
      needs_input: empty,
      source_doc_id: i.source_doc_id,
      source_page: i.source_page,
      source_evidence: i.source_evidence,
      source_unanswered_id: i.source_unanswered_id,
      draft_note: i.draft_note ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
