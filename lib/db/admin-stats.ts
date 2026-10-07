import "server-only";
import { createServerClient } from "./server";
import { addDaysYmd, kstDayStartISO, kstTodayYmd, kstWeekStartYmd } from "@/lib/admin/labels";

export interface PeriodStats {
  total: number;
  byRoute: Record<string, number>;
  /** 답변 성공률 = answered ÷ (answered + handoff). 챗봇이 답해야 했던 문의 중 실제로 답한 비율. 분모가 0이면 null */
  successRate: number | null;
}

export interface TopQuestion {
  question: string;
  count: number;
  topRoute: string;
}

export interface DashboardStats {
  today: PeriodStats;
  week: PeriodStats;
  topQuestions: TopQuestion[];
  openUnanswered: number;
  ranges: { todayStart: string; weekStart: string; topFrom: string };
}

const CHUNK = 1000; // PostgREST 기본 최대 응답 행 수
const MAX_ROWS = 50000;

async function fetchAllSince(columns: string, sinceISO: string): Promise<Record<string, string>[]> {
  const sb = createServerClient();
  const out: Record<string, string>[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const { data, error } = await sb
      .from("chat_log")
      .select(columns)
      .gte("created_at", sinceISO)
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, string>[];
    out.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return out;
}

const normalizeQuestion = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

export function summarize(routes: string[]): PeriodStats {
  const byRoute: Record<string, number> = {};
  for (const r of routes) byRoute[r] = (byRoute[r] ?? 0) + 1;
  const answered = byRoute.answered ?? 0;
  const handoff = byRoute.handoff ?? 0;
  return { total: routes.length, byRoute, successRate: answered + handoff > 0 ? answered / (answered + handoff) : null };
}

export async function getDashboardStats(now = new Date()): Promise<DashboardStats> {
  const todayYmd = kstTodayYmd(now);
  const weekYmd = kstWeekStartYmd(now);
  const topFromYmd = addDaysYmd(todayYmd, -29); // 오늘 포함 최근 30일
  const todayStart = kstDayStartISO(todayYmd);
  const weekStart = kstDayStartISO(weekYmd);
  const topFrom = kstDayStartISO(topFromYmd);

  // 주간 통계와 Top 10 을 한 번에: 더 이른 시작 시각부터 가져와 메모리에서 나눈다
  const since = topFrom < weekStart ? topFrom : weekStart;
  const rows = await fetchAllSince("question, route, created_at", since);

  const todayRows = rows.filter((r) => r.created_at >= todayStart);
  const weekRows = rows.filter((r) => r.created_at >= weekStart);
  const topRows = rows.filter((r) => r.created_at >= topFrom);

  const groups = new Map<string, { question: string; count: number; routes: Record<string, number> }>();
  for (const r of topRows) {
    const key = normalizeQuestion(r.question);
    const g = groups.get(key) ?? { question: r.question.trim(), count: 0, routes: {} };
    g.count++;
    g.routes[r.route] = (g.routes[r.route] ?? 0) + 1;
    groups.set(key, g);
  }
  const topQuestions = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.question.localeCompare(b.question, "ko"))
    .slice(0, 10)
    .map((g) => ({
      question: g.question,
      count: g.count,
      topRoute: Object.entries(g.routes).sort((a, b) => b[1] - a[1])[0][0],
    }));

  const { count, error } = await createServerClient()
    .from("unanswered")
    .select("id", { count: "exact", head: true })
    .eq("resolved", false);
  if (error) throw error;

  return {
    today: summarize(todayRows.map((r) => r.route)),
    week: summarize(weekRows.map((r) => r.route)),
    topQuestions,
    openUnanswered: count ?? 0,
    ranges: { todayStart, weekStart, topFrom },
  };
}
