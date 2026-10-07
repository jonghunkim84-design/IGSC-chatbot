import "server-only";
import { createAuthClient } from "@/lib/db/auth";
import { isAllowedEmail } from "./allowlist";

/**
 * 라우트 핸들러(API)용 2차 방어 (미들웨어가 1차). requireAdmin 은 로그인 화면으로 redirect 하므로
 * API 에서는 쓰지 않고, 허용된 관리자 이메일이면 돌려주고 아니면 null 을 돌려준다.
 */
export async function getAdminEmail(): Promise<string | null> {
  const supabase = await createAuthClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  return email && isAllowedEmail(email) ? email : null;
}
