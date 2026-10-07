import "server-only";
import { createServerClient } from "./server";
import type { ChatLog } from "./types";
import { PAGE_SIZE, addDaysYmd, kstDayStartISO } from "@/lib/admin/labels";

export interface LogFilter {
  from?: string; // YYYY-MM-DD (KST)
  to?: string; // YYYY-MM-DD (KST, 포함)
  route?: string;
  page?: number;
}

export interface LogRow extends Omit<ChatLog, "route"> {
  route: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function listChatLogs(
  f: LogFilter,
): Promise<{ rows: LogRow[]; total: number; faqQuestions: Map<string, { question: string; status: string }> }> {
  const page = Math.max(1, f.page ?? 1);
  const sb = createServerClient();
  let q = sb.from("chat_log").select("*", { count: "exact" });
  if (f.route) q = q.eq("route", f.route);
  if (f.from && YMD.test(f.from)) q = q.gte("created_at", kstDayStartISO(f.from));
  if (f.to && YMD.test(f.to)) q = q.lt("created_at", kstDayStartISO(addDaysYmd(f.to, 1)));
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  const rows = (data ?? []) as LogRow[];

  // 근거 FAQ 질문 (이 페이지에 나온 id 들만 한 번에 조회)
  const ids = [...new Set(rows.flatMap((r) => r.matched_faq_ids ?? []))];
  const faqQuestions = new Map<string, { question: string; status: string }>();
  if (ids.length) {
    const { data: faqs, error: e2 } = await sb.from("faq").select("id, question, status").in("id", ids);
    if (e2) throw e2;
    for (const r of faqs ?? []) faqQuestions.set(r.id as string, { question: r.question as string, status: r.status as string });
  }
  return { rows, total: count ?? 0, faqQuestions };
}
