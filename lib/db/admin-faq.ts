import "server-only";
import { createServerClient } from "./server";
import type { Faq, FaqCategory, FaqStatus } from "./types";
import { PAGE_SIZE } from "@/lib/admin/labels";

export interface FaqFilter {
  certType?: string;
  category?: string;
  status?: string;
  q?: string;
  /** true 면 재검토가 필요한 FAQ 만 */
  review?: boolean;
  page?: number;
}

/** PostgREST or()/ilike 필터에서 문제가 되는 문자를 제거한다. */
const sanitize = (s: string) => s.replace(/[,()%_*\\]/g, " ").trim();

export async function listFaqs(f: FaqFilter): Promise<{ rows: Faq[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  let q = createServerClient().from("faq").select("*", { count: "exact" });
  if (f.certType) q = q.eq("cert_type", f.certType);
  if (f.category) q = q.eq("category", f.category);
  if (f.status) q = q.eq("status", f.status);
  if (f.review) q = q.eq("needs_review", true);
  const kw = f.q ? sanitize(f.q) : "";
  if (kw) q = q.or(`question.ilike.%${kw}%,answer.ilike.%${kw}%`);
  const { data, error, count } = await q
    .order("updated_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as Faq[], total: count ?? 0 };
}

export async function getFaq(id: string): Promise<Faq | null> {
  const { data, error } = await createServerClient().from("faq").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Faq | null) ?? null;
}

/** DB에 실제로 쓰이는 cert_type 목록 (필터 선택지용) */
export async function listFaqCertTypes(): Promise<string[]> {
  const { data, error } = await createServerClient().from("faq").select("cert_type");
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.cert_type as string))].sort();
}

export interface FaqInput {
  question: string;
  variants: string[];
  answer: string;
  cert_type: string;
  category: FaqCategory;
  source_url: string | null;
  status: FaqStatus;
  needs_input: boolean;
}

const CATEGORIES = ["procedure", "cost", "duration", "document", "scope", "renewal"];

/** 저장 전 검증. 문제가 있으면 사용자에게 보여줄 한국어 메시지를 반환한다. */
export function validateFaqInput(i: FaqInput): string | null {
  if (!i.question.trim()) return "질문을 입력해 주세요.";
  if (i.question.length > 300) return "질문은 300자 이내로 입력해 주세요.";
  if (i.answer.length > 3000) return "답변은 3000자 이내로 입력해 주세요.";
  if (i.variants.length > 20 || i.variants.some((v) => v.length > 200)) return "다른 표현은 최대 20개, 각 200자 이내로 입력해 주세요.";
  if (!/^[a-z0-9-]+$/.test(i.cert_type)) return "인증 종류를 선택해 주세요.";
  if (!CATEGORIES.includes(i.category)) return "카테고리를 선택해 주세요.";
  if (i.source_url && !/^https?:\/\/\S+$/.test(i.source_url)) return "출처 URL은 http:// 또는 https:// 로 시작해야 합니다.";
  if (i.status === "approved") {
    if (i.needs_input) return "'담당자 입력 필요' 표시가 켜진 항목은 승인할 수 없습니다. 답변을 채운 뒤 표시를 해제해 주세요.";
    if (!i.answer.trim()) return "답변이 비어 있는 항목은 승인할 수 없습니다.";
  }
  return null;
}

/**
 * 초안(draft) FAQ 삭제. 승인된 FAQ 는 조건(status='draft')에서 걸러져 삭제되지 않는다.
 * 이 초안에서 파생된 기록(미답변 질문의 '초안 있음' 표시 등)은 FAQ 행과 함께 사라진다.
 */
export async function deleteDraftFaq(id: string): Promise<{ ok: true } | { ok: false; reason: "not_found" | "approved" }> {
  const sb = createServerClient();
  const { data, error } = await sb.from("faq").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) throw error;
  if ((data?.length ?? 0) > 0) return { ok: true };
  const { data: row } = await sb.from("faq").select("status").eq("id", id).maybeSingle();
  return { ok: false, reason: row?.status === "approved" ? "approved" : "not_found" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 초안(draft) FAQ 여러 건 삭제. 승인된 FAQ 는 조건(status='draft')에서 걸러져 삭제되지 않는다.
 * 돌려주는 skipped 는 삭제하지 않은 건수(승인됨·이미 없음·잘못된 id).
 */
export async function deleteDraftFaqs(ids: string[]): Promise<{ deleted: number; skipped: number }> {
  const unique = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  const sb = createServerClient();
  let deleted = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const { data, error } = await sb.from("faq").delete().in("id", batch).eq("status", "draft").select("id, question");
    if (error) throw error;
    deleted += data?.length ?? 0;
    console.info(`[admin] FAQ 초안 일괄 삭제: ${(data ?? []).map((r) => `${r.id} ${r.question}`).join(" | ")}`);
  }
  return { deleted, skipped: new Set(ids).size - deleted };
}

export async function insertFaqAdmin(i: FaqInput): Promise<Faq> {
  const { data, error } = await createServerClient().from("faq").insert(toRow(i)).select().single();
  if (error) throw error;
  return data as Faq;
}

export async function updateFaqAdmin(id: string, i: FaqInput): Promise<Faq> {
  const { data, error } = await createServerClient().from("faq").update(toRow(i)).eq("id", id).select().single();
  if (error) throw error;
  return data as Faq;
}

const toRow = (i: FaqInput) => ({
  question: i.question.trim(),
  variants: i.variants.map((v) => v.trim()).filter(Boolean),
  answer: i.answer.trim(),
  cert_type: i.cert_type,
  category: i.category,
  source_url: i.source_url?.trim() || null,
  status: i.status,
  needs_input: i.needs_input,
});

/** 승인 기록: 누가 언제 승인했는지. 승인되는 모든 경로(단건·일괄·검수 큐·수정 화면)가 항목마다 이 값을 남긴다. */
export const approvalFields = (approver: string) => ({ approved_by: approver, approved_at: new Date().toISOString() });

/**
 * 수정 화면 저장 뒤 승인 기록을 맞춘다: 승인으로 바뀌었으면 승인자·시각을 남기고, 초안으로 돌아갔으면 지운다.
 * 이미 승인된 FAQ 를 고쳐 다시 저장한 경우(상태 변화 없음)는 처음 승인한 기록을 그대로 둔다.
 */
export async function syncApproval(id: string, before: FaqStatus | null, after: FaqStatus, approver: string): Promise<void> {
  if (after === "approved" && before !== "approved") {
    const { error } = await createServerClient().from("faq").update(approvalFields(approver)).eq("id", id);
    if (error) throw error;
  } else if (after !== "approved" && before === "approved") {
    const { error } = await createServerClient().from("faq").update({ approved_by: null, approved_at: null }).eq("id", id);
    if (error) throw error;
  }
}

/**
 * 일괄 승인. 답변이 비었거나 needs_input 인 항목은 승인하지 않고 건너뛴다.
 * (승인 UPDATE 자체에 조건을 걸어 동시 수정과도 경합하지 않게 한다.)
 */
export async function bulkApprove(ids: string[], approver: string): Promise<{ approved: number; skipped: number }> {
  if (ids.length === 0) return { approved: 0, skipped: 0 };
  const { data, error } = await createServerClient()
    .from("faq")
    .update({ status: "approved", ...approvalFields(approver) })
    .in("id", ids)
    .neq("status", "approved")
    .eq("needs_input", false)
    .neq("answer", "")
    .select("id");
  if (error) throw error;
  const approved = data?.length ?? 0;
  return { approved, skipped: ids.length - approved };
}
