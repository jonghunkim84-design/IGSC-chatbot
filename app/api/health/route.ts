import { NextResponse } from "next/server";
import { checkAi, checkDb } from "@/lib/monitor/collect";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — 배포 점검(smoke:deploy)과 외부 가동 감시(UptimeRobot 등)용. 인증 없음, 세부 오류는 노출하지 않는다.
 * DB·AI 가 모두 되면 200, 하나라도 안 되면 503. AI 점검은 5분간 결과를 재사용한다 (호출 비용 보호).
 */
export async function GET(req: Request) {
  const limit = await checkRateLimit([{ name: "health", subject: getClientIp(req), windowSeconds: 60, limit: 30 }]);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, status: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const [db, ai] = await Promise.all([checkDb(), checkAi()]);
  const ok = db.ok && ai.ok;
  return NextResponse.json(
    { ok, status: ok ? "ok" : "down", db: db.ok, ai: ai.ok },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
