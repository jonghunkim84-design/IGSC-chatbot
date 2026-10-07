import "server-only";
import { createServerClient } from "./server";
import type { Unanswered } from "./types";
import { PAGE_SIZE } from "@/lib/admin/labels";

/**
 * 미답변 목록. kind: 'partial' = 일부 안내 후 담당자 확인으로 넘긴 건, 'none' = 전혀 답하지 못한 건.
 * 부분 안내 여부는 연결된 chat_log 의 route 가 'answered' 인지로 판단한다 (미답변 행은 전부 담당자 이관이거나
 * 부분 안내이고, 부분 안내만 answered 로 기록되므로 별도 컬럼이 필요 없다).
 */
export async function listUnansweredAdmin(opts: {
  resolved?: boolean;
  page?: number;
  kind?: "partial" | "none";
}): Promise<{ rows: Unanswered[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const db = createServerClient();

  let excludeIds: string[] = [];
  if (opts.kind === "none") {
    let pq = db.from("unanswered").select("id, chat_log!inner(route)").eq("chat_log.route", "answered");
    if (opts.resolved !== undefined) pq = pq.eq("resolved", opts.resolved);
    const { data, error } = await pq.limit(1000);
    if (error) throw error;
    excludeIds = (data ?? []).map((r) => r.id as string);
  }

  let q =
    opts.kind === "partial"
      ? db.from("unanswered").select("*, chat_log!inner(route)", { count: "exact" }).eq("chat_log.route", "answered")
      : db.from("unanswered").select("*, chat_log(route)", { count: "exact" });
  if (opts.resolved !== undefined) q = q.eq("resolved", opts.resolved);
  if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  type Row = Unanswered & { chat_log: { route: string } | { route: string }[] | null };
  const rows = ((data ?? []) as unknown as Row[]).map(({ chat_log, ...rest }) => {
    const log = Array.isArray(chat_log) ? chat_log[0] : chat_log;
    return { ...rest, partial: log?.route === "answered" } as Unanswered;
  });
  return { rows, total: count ?? 0 };
}

export async function getUnansweredAdmin(id: string): Promise<Unanswered | null> {
  const { data, error } = await createServerClient().from("unanswered").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Unanswered | null) ?? null;
}

export async function setUnansweredResolved(id: string, resolved: boolean): Promise<void> {
  const { error } = await createServerClient().from("unanswered").update({ resolved }).eq("id", id);
  if (error) throw error;
}
