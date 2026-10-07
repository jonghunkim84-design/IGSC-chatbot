import { NextResponse } from "next/server";
import { sendAlerts } from "@/lib/monitor/alert";
import { collectSignals } from "@/lib/monitor/collect";
import { evaluate, overall } from "@/lib/monitor/evaluate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/cron/monitor — Vercel Cron 이 주기적으로 호출한다 (vercel.json).
 * Authorization: Bearer $CRON_SECRET 이 맞아야 한다 (Vercel 은 CRON_SECRET 환경변수가 있으면 자동으로 붙여 보낸다).
 * 문제가 있으면 관리자 이메일(RESEND_API_KEY 필요)과 ALERT_WEBHOOK_URL 로 알린다 (같은 문제는 6시간에 한 번).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET 이 설정되지 않았습니다." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const signals = await collectSignals({ forceAi: true });
  const issues = evaluate(signals);
  let alert: { sent: number; suppressed: number; logOnly: boolean; channels: string[] } | { error: string } = { sent: 0, suppressed: 0, logOnly: false, channels: [] };
  if (issues.length) {
    try {
      const r = await sendAlerts(issues);
      alert = { sent: r.sent.length, suppressed: r.suppressed.length, logOnly: r.logOnly, channels: r.channels };
    } catch (err) {
      alert = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return NextResponse.json({ status: overall(issues), issues, alert });
}
