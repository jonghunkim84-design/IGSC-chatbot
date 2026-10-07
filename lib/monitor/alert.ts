import "server-only";
import { parseAllowedEmails } from "@/lib/admin/allowlist";
import { checkRateLimit, type HitFn } from "@/lib/rate-limit";
import type { Issue } from "./evaluate";

/** 같은 문제는 이 시간 동안 한 번만 알린다 */
export const ALERT_COOLDOWN_SECONDS = 6 * 3600;

export interface AlertResult {
  sent: Issue[];
  suppressed: Issue[];
  /** 알림 채널(이메일·웹훅)이 하나도 설정되지 않아 로그로만 남긴 경우 */
  logOnly: boolean;
  channels: string[];
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export interface AlertDeps {
  /** Slack 호환 웹훅 (ALERT_WEBHOOK_URL) */
  webhookUrl?: string;
  /** 이메일 수신자. 기본은 관리자 이메일 목록(ADMIN_ALLOWED_EMAILS) */
  emailTo?: string[];
  /** Resend API 키 (RESEND_API_KEY). 없으면 이메일은 보내지 않는다 */
  resendKey?: string;
  /** 보내는 사람 (ALERT_EMAIL_FROM). 기본은 Resend 테스트 주소 */
  emailFrom?: string;
  siteUrl?: string;
  hit?: HitFn;
  fetchFn?: Fetch;
}

export function formatAlert(issues: Issue[], siteUrl?: string): string {
  const lines = issues.map((i) => `${i.level === "critical" ? "🔴 긴급" : "🟡 주의"} ${i.message}`);
  return `[IGSC 챗봇 운영 알림]\n${lines.join("\n")}${siteUrl ? `\n상태 화면: ${siteUrl}/admin/status` : ""}`;
}

export function alertSubject(issues: Issue[]): string {
  return `[IGSC 챗봇] ${issues.some((i) => i.level === "critical") ? "긴급" : "주의"}: ${issues[0].message.slice(0, 40)}`;
}

/**
 * 문제를 알린다. 채널: 이메일(관리자 이메일 목록 + RESEND_API_KEY), Slack 호환 웹훅(ALERT_WEBHOOK_URL).
 * 같은 문제(code)는 쿨다운 동안 다시 보내지 않는다. 채널이 없으면 로그에만 남기고 쿨다운은 쓰지 않는다
 * (나중에 채널을 설정하면 바로 알림이 나가도록). 한 채널이 실패해도 다른 채널은 보낸다. 모든 채널이 실패하면 throw 한다.
 */
export async function sendAlerts(issues: Issue[], deps: AlertDeps = {}): Promise<AlertResult> {
  const webhookUrl = deps.webhookUrl ?? process.env.ALERT_WEBHOOK_URL;
  const resendKey = deps.resendKey ?? process.env.RESEND_API_KEY;
  const emailTo = deps.emailTo ?? parseAllowedEmails(process.env.ADMIN_ALLOWED_EMAILS);
  const emailFrom = deps.emailFrom ?? process.env.ALERT_EMAIL_FROM ?? "IGSC 챗봇 <onboarding@resend.dev>";
  const siteUrl = deps.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL;
  const doFetch = deps.fetchFn ?? (fetch as unknown as Fetch);

  const channels: string[] = [];
  if (resendKey && emailTo.length) channels.push("email");
  if (webhookUrl) channels.push("webhook");
  if (channels.length === 0) {
    console.error(`[monitor] 알림 채널 없음, 로그만: ${formatAlert(issues, siteUrl)}`);
    return { sent: [], suppressed: [], logOnly: true, channels };
  }

  const fresh: Issue[] = [];
  const suppressed: Issue[] = [];
  for (const issue of issues) {
    const r = await checkRateLimit([{ name: "alert", subject: issue.code, windowSeconds: ALERT_COOLDOWN_SECONDS, limit: 1 }], deps.hit);
    (r.allowed ? fresh : suppressed).push(issue);
  }
  if (fresh.length === 0) return { sent: [], suppressed, logOnly: false, channels };

  const text = formatAlert(fresh, siteUrl);
  const failures: string[] = [];
  if (channels.includes("email")) {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from: emailFrom, to: emailTo, subject: alertSubject(fresh), text }),
    }).catch((e: unknown) => ({ ok: false, status: 0, error: e }));
    if (!res.ok) failures.push(`이메일 HTTP ${res.status}`);
  }
  if (channels.includes("webhook")) {
    const res = await doFetch(webhookUrl!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(
      (e: unknown) => ({ ok: false, status: 0, error: e }),
    );
    if (!res.ok) failures.push(`웹훅 HTTP ${res.status}`);
  }
  if (failures.length) {
    console.error(`[monitor] 알림 전송 실패: ${failures.join(", ")}`);
    if (failures.length === channels.length) throw new Error(`알림 전송 실패: ${failures.join(", ")}`);
  }
  return { sent: fresh, suppressed, logOnly: false, channels };
}
