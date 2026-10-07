import { NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/admin/allowlist";
import { createAuthClient } from "@/lib/db/auth";
import { checkRateLimit, getClientIp, loginRules } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/admin/login { email }
 * 허용 목록에 있는 이메일에만 매직링크를 보낸다. 허용 여부와 무관하게 응답은 동일하다
 * (등록된 관리자 주소를 외부에서 추측할 수 없도록).
 */
export async function POST(req: Request) {
  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return NextResponse.json({ error: "이메일 주소를 확인해 주세요." }, { status: 400 });
  }

  const limit = await checkRateLimit(loginRules(getClientIp(req), email));
  if (!limit.allowed) {
    console.warn(`[admin/login] 요청 제한 초과: ${limit.rule}`);
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (isAllowedEmail(email)) {
    try {
      const supabase = await createAuthClient();
      const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(req.url).origin;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/admin/auth/callback`, shouldCreateUser: true },
      });
      if (error) throw error;
    } catch (err) {
      console.error("[admin/login] 매직링크 발송 실패:", err);
      return NextResponse.json({ error: "로그인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
