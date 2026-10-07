import "server-only";
import { createServerClient } from "./server";

/** DB 연결 확인용 가벼운 조회 */
export async function pingDb(): Promise<void> {
  const { error } = await createServerClient().from("faq").select("id", { head: true, count: "exact" }).limit(1);
  if (error) throw error;
}

export interface MonitorCounts {
  chatLastHour: number;
  errorsLastHour: number;
  dailyUsed: number;
  approvedFaq: number;
  openUnanswered: number;
}

/** 운영 모니터링 지표. errorAnswer 는 오류 시 사용자에게 나가는 고정 문구(chat_log.answer 와 같은 값). */
export async function getMonitorCounts(errorAnswer: string): Promise<MonitorCounts> {
  const sb = createServerClient();
  const sinceHour = new Date(Date.now() - 3600_000).toISOString();
  const dayStart = new Date(Math.floor(Date.now() / 86400_000) * 86400_000).toISOString();
  const [total, errors, daily, faq, un] = await Promise.all([
    sb.from("chat_log").select("id", { count: "exact", head: true }).gte("created_at", sinceHour),
    sb.from("chat_log").select("id", { count: "exact", head: true }).gte("created_at", sinceHour).eq("answer", errorAnswer),
    sb.from("rate_limits").select("count").eq("key", "chat-day-all:all").eq("window_start", dayStart).maybeSingle(),
    sb.from("faq").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("unanswered").select("id", { count: "exact", head: true }).eq("resolved", false),
  ]);
  for (const r of [total, errors, daily, faq, un]) if (r.error) throw r.error;
  return {
    chatLastHour: total.count ?? 0,
    errorsLastHour: errors.count ?? 0,
    dailyUsed: daily.data?.count ?? 0,
    approvedFaq: faq.count ?? 0,
    openUnanswered: un.count ?? 0,
  };
}
