import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/admin/allowlist";
import { createAuthClient } from "@/lib/db/auth";

export const dynamic = "force-dynamic";

/** 매직링크 콜백: ?code= 를 세션으로 교환하고, 허용된 이메일이면 /admin 으로 보낸다. */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const fail = (reason: string) => NextResponse.redirect(`${origin}/admin/login?error=${reason}`);
  if (!code) return fail("link");

  const supabase = await createAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[admin/callback] 세션 교환 실패:", error.message);
    return fail("link");
  }
  const { data } = await supabase.auth.getUser();
  if (!isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return fail("forbidden");
  }
  return NextResponse.redirect(`${origin}/admin`);
}
