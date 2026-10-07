import "server-only";
import { createServerClient } from "./server";
import type { Faq, NewFaq } from "./types";

/** 승인된 FAQ 전체(프롬프트 선택 방식의 입력). certType 지정 시 해당 인증 + common 만. */
export async function listApprovedFaqs(certType?: string): Promise<Faq[]> {
  let q = createServerClient().from("faq").select("*").eq("status", "approved");
  if (certType) q = q.in("cert_type", [certType, "common"]);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return data as Faq[];
}

/** id 목록으로 승인된 FAQ만 조회. draft는 id를 알아도 반환하지 않는다. */
export async function getApprovedFaqsByIds(ids: string[]): Promise<Faq[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createServerClient()
    .from("faq")
    .select("*")
    .eq("status", "approved")
    .in("id", ids);
  if (error) throw error;
  return data as Faq[];
}

export async function insertFaq(input: NewFaq): Promise<Faq> {
  const { data, error } = await createServerClient()
    .from("faq")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Faq;
}

export async function setFaqStatus(id: string, status: Faq["status"]): Promise<void> {
  const { error } = await createServerClient().from("faq").update({ status }).eq("id", id);
  if (error) throw error;
}

export type FaqIndexItem = Pick<Faq, "id" | "question" | "variants" | "cert_type">;
export type FaqAnswerRow = Pick<
  Faq,
  "id" | "question" | "answer" | "source_url" | "cert_type" | "category" | "needs_input"
>;

/** 승인된 FAQ의 선택용 인덱스. answer는 조회하지 않는다 (토큰 절약). */
export async function listApprovedFaqIndex(): Promise<FaqIndexItem[]> {
  const { data, error } = await createServerClient()
    .from("faq")
    .select("id, question, variants, cert_type")
    .eq("status", "approved")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data as FaqIndexItem[];
}

/** 선택된 id의 답변 조회. 그 사이 승인 취소된 항목은 제외된다. */
export async function getApprovedFaqAnswers(ids: string[]): Promise<FaqAnswerRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createServerClient()
    .from("faq")
    .select("id, question, answer, source_url, cert_type, category, needs_input")
    .eq("status", "approved")
    .in("id", ids);
  if (error) throw error;
  return data as FaqAnswerRow[];
}

/**
 * 승인 FAQ 변경 감지용 지문 = "승인 개수|가장 최근 updated_at".
 * 수정·승인·승인 취소·삭제 어느 것이든 지문이 바뀐다 (updated_at 은 UPDATE 트리거가 갱신).
 * 행 하나만 읽는 가벼운 쿼리라서 챗봇 요청마다 호출해도 부담이 작다.
 */
export async function getApprovedFaqFingerprint(): Promise<string> {
  const { data, error, count } = await createServerClient()
    .from("faq")
    .select("updated_at", { count: "exact" })
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return `${count ?? 0}|${data?.[0]?.updated_at ?? ""}`;
}
