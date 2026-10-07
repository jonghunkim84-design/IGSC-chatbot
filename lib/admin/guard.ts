import "server-only";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/db/auth";
import { isAllowedEmail } from "./allowlist";

/**
 * 서버 컴포넌트·서버 액션에서 호출하는 2차 방어 (미들웨어가 1차).
 * 로그인하지 않았거나 허용되지 않은 이메일이면 로그인 화면으로 보낸다.
 */
export async function requireAdmin(): Promise<{ email: string }> {
  const supabase = await createAuthClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email || !isAllowedEmail(email)) {
    if (email) await supabase.auth.signOut();
    redirect(`/admin/login${email ? "?error=forbidden" : ""}`);
  }
  return { email };
}
