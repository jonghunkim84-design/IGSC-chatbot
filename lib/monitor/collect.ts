import "server-only";
import { getMonitorCounts, pingDb } from "@/lib/db/monitor";
import { CLASSIFY_MODEL, getAnthropic } from "@/lib/chat/anthropic";
import { MSG_ERROR_HANDOFF } from "@/lib/prompts/messages";
import { limits } from "@/lib/rate-limit";
import type { Signals } from "./evaluate";

const AI_CACHE_MS = 5 * 60 * 1000;
let aiCache: { at: number; ok: boolean; error?: string } | null = null;

/** 가장 작은 모델 호출로 AI 연결을 확인한다. 비용 때문에 5분간 결과를 재사용한다. */
export async function checkAi(force = false): Promise<{ ok: boolean; error?: string }> {
  if (!force && aiCache && Date.now() - aiCache.at < AI_CACHE_MS) return aiCache;
  let r: { ok: boolean; error?: string };
  try {
    await getAnthropic().messages.create({ model: CLASSIFY_MODEL, max_tokens: 1, messages: [{ role: "user", content: "ping" }] });
    r = { ok: true };
  } catch (err) {
    console.error("[monitor] AI 점검 실패:", err);
    r = { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : String(err) };
  }
  aiCache = { at: Date.now(), ...r };
  return r;
}

export async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await pingDb();
    return { ok: true };
  } catch (err) {
    console.error("[monitor] DB 점검 실패:", err);
    return { ok: false, error: String((err as { message?: string })?.message ?? err).slice(0, 160) };
  }
}

/** 운영 신호를 모은다. DB 가 안 되면 나머지 지표는 건너뛴다. */
export async function collectSignals(opts: { forceAi?: boolean } = {}): Promise<Signals> {
  const [db, ai] = await Promise.all([checkDb(), checkAi(opts.forceAi)]);
  const signals: Signals = {
    dbOk: db.ok,
    dbError: db.error,
    aiOk: ai.ok,
    aiError: ai.error,
    lastHour: { total: 0, errors: 0 },
    daily: { used: 0, cap: limits.chatGlobalPerDay() },
    approvedFaq: 0,
    openUnanswered: 0,
  };
  if (!db.ok) return signals;
  try {
    const c = await getMonitorCounts(MSG_ERROR_HANDOFF);
    signals.lastHour = { total: c.chatLastHour, errors: c.errorsLastHour };
    signals.daily.used = c.dailyUsed;
    signals.approvedFaq = c.approvedFaq;
    signals.openUnanswered = c.openUnanswered;
  } catch (err) {
    console.error("[monitor] 지표 수집 실패:", err);
  }
  return signals;
}
