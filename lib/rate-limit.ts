import "server-only";
import { createHash } from "node:crypto";
import { createServerClient } from "@/lib/db/server";

export interface RateRule {
  /** 규칙 이름 (키 접두사) */
  name: string;
  /** 대상 식별값 (IP, 이메일 등). 저장 전에 해시한다. 전역 규칙이면 생략 */
  subject?: string;
  windowSeconds: number;
  limit: number;
}

export interface RateResult {
  allowed: boolean;
  retryAfter: number;
  rule?: string;
}

/** 한 구간의 카운터를 1 올리고 결과를 돌려주는 저장소 (테스트에서 교체) */
export type HitFn = (key: string, windowSeconds: number, limit: number) => Promise<{ allowed: boolean; retryAfter: number }>;

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** 환경 변수로 조정 가능한 기본 한도 */
export const limits = {
  chatPerMinute: () => envInt("RATE_CHAT_PER_MINUTE", 15),
  chatPerHour: () => envInt("RATE_CHAT_PER_HOUR", 120),
  chatGlobalPerDay: () => envInt("RATE_CHAT_GLOBAL_PER_DAY", 3000),
  loginPerHourByIp: () => envInt("RATE_LOGIN_PER_HOUR_IP", 10),
  loginPerHourByEmail: () => envInt("RATE_LOGIN_PER_HOUR_EMAIL", 5),
};

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function hashSubject(s: string): string {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "igsc";
  return createHash("sha256").update(`${salt}:${s}`).digest("hex").slice(0, 32);
}

// DB 장애 시 인스턴스 메모리로 대신 제한한다 (서버리스에서는 인스턴스별이라 느슨하지만, 제한이 아예 꺼지는 것보다 낫다).
const mem = new Map<string, { start: number; count: number }>();
export function memoryHit(key: string, windowSeconds: number, limit: number, now = Date.now()) {
  const w = windowSeconds * 1000;
  const start = Math.floor(now / w) * w;
  const cur = mem.get(key);
  const count = cur && cur.start === start ? cur.count + 1 : 1;
  mem.set(key, { start, count });
  if (mem.size > 5000) for (const [k, v] of mem) if (v.start < now - 2 * 3600_000) mem.delete(k);
  return { allowed: count <= limit, retryAfter: Math.max(1, Math.ceil((start + w - now) / 1000)) };
}

const dbHit: HitFn = async (key, windowSeconds, limit) => {
  const { data, error } = await createServerClient().rpc("rate_limit_hit", {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_limit: limit,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { allowed: !!row?.allowed, retryAfter: Number(row?.retry_after) || windowSeconds };
};

/**
 * 규칙을 차례로 확인한다. 하나라도 넘으면 거부. (앞 규칙에서 거부되면 뒤 규칙은 세지 않는다.)
 * 저장소 오류는 삼키지 않고 로깅한 뒤 메모리 제한으로 대체한다 — 장애 때문에 고객 응대가 막히지는 않게.
 */
export async function checkRateLimit(rules: RateRule[], hit: HitFn = dbHit): Promise<RateResult> {
  for (const r of rules) {
    const key = `${r.name}:${r.subject ? hashSubject(r.subject) : "all"}`;
    let res: { allowed: boolean; retryAfter: number };
    try {
      res = await hit(key, r.windowSeconds, r.limit);
    } catch (err) {
      console.error("[rate-limit] 저장소 오류, 메모리 제한으로 대체:", err);
      res = memoryHit(key, r.windowSeconds, r.limit);
    }
    if (!res.allowed) return { allowed: false, retryAfter: res.retryAfter, rule: r.name };
  }
  return { allowed: true, retryAfter: 0 };
}

export const chatRules = (ip: string): RateRule[] => [
  { name: "chat-min", subject: ip, windowSeconds: 60, limit: limits.chatPerMinute() },
  { name: "chat-hour", subject: ip, windowSeconds: 3600, limit: limits.chatPerHour() },
  { name: "chat-day-all", windowSeconds: 86400, limit: limits.chatGlobalPerDay() },
];

export const loginRules = (ip: string, email: string): RateRule[] => [
  { name: "login-ip", subject: ip, windowSeconds: 3600, limit: limits.loginPerHourByIp() },
  { name: "login-email", subject: email, windowSeconds: 3600, limit: limits.loginPerHourByEmail() },
];
