import "server-only";
import { createServerClient } from "./server";
import type { ChannelRow } from "@/lib/admin/channel-stats";

const CHUNK = 1000; // PostgREST 기본 최대 응답 행 수
const MAX_ROWS = 100000;

export type ChannelRowsResult = { ok: true; rows: ChannelRow[] } | { ok: false; reason: "migration" };

/** 지정 시각 이후(없으면 전체)의 대화 기록에서 채널 집계에 필요한 열만 가져온다. 0012 적용 전이면 reason='migration'. */
export async function listChannelRows(sinceISO: string | null): Promise<ChannelRowsResult> {
  const sb = createServerClient();
  const rows: ChannelRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    let q = sb.from("chat_log").select("session_id, route, source, source_detail");
    if (sinceISO) q = q.gte("created_at", sinceISO);
    const { data, error } = await q.order("created_at", { ascending: true }).order("id").range(from, from + CHUNK - 1);
    if (error) {
      if (/source/.test(error.message ?? "")) return { ok: false, reason: "migration" };
      throw error;
    }
    const part = (data ?? []) as ChannelRow[];
    rows.push(...part);
    if (part.length < CHUNK) break;
  }
  return { ok: true, rows };
}
