/** ADMIN_ALLOWED_EMAILS (쉼표 구분) 에 등록된 이메일만 관리자 화면에 접근할 수 있다. */

export function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined, raw = process.env.ADMIN_ALLOWED_EMAILS): boolean {
  if (!email) return false;
  return parseAllowedEmails(raw).includes(email.trim().toLowerCase());
}
