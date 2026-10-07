import "server-only";
import { createServerClient } from "./server";
import type { ChatLog, NewChatLog } from "./types";

export async function insertChatLog(input: NewChatLog): Promise<ChatLog> {
  const sb = createServerClient();
  const { data, error } = await sb.from("chat_log").insert(input).select().single();
  if (!error) return data as ChatLog;
  // 마이그레이션 0012(source 컬럼) 적용 전이면 채널 값만 빼고 다시 기록한다 (대화 기록 자체가 사라지지 않게)
  if ((input.source || input.source_detail) && /source/.test(error.message ?? "")) {
    console.error("[chat-log] source 컬럼 없음 — 채널 없이 기록합니다. supabase/migrations/0012 를 적용하세요:", error.message);
    const { source: _s, source_detail: _d, ...rest } = input;
    void _s;
    void _d;
    const retry = await sb.from("chat_log").insert(rest).select().single();
    if (retry.error) throw retry.error;
    return retry.data as ChatLog;
  }
  throw error;
}
