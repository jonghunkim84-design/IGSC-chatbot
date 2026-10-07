import { isAllowedEmail } from "./allowlist";

/** 로그인 없이 접근 가능한 관리자 경로 (로그인 화면, 로그인 링크 콜백, 로그인 요청 API) */
const PUBLIC_PATHS = ["/admin/login", "/admin/auth", "/api/admin/login"];
const isPublic = (pathname: string) => PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export type AccessDecision = "allow" | "login" | "forbidden";

/**
 * 미들웨어의 접근 판정 (순수 함수).
 * - 공개 경로: 항상 allow
 * - 그 외 /admin, /api/admin: 로그인 + 허용 이메일이면 allow, 로그인 안 했으면 login, 허용되지 않은 이메일이면 forbidden
 */
export function decideAccess(pathname: string, email: string | null | undefined, allowedRaw?: string): AccessDecision {
  if (isPublic(pathname)) return "allow";
  if (!email) return "login";
  return isAllowedEmail(email, allowedRaw ?? process.env.ADMIN_ALLOWED_EMAILS) ? "allow" : "forbidden";
}
