import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * 서버용 클라이언트 (service role key, RLS 우회).
 * `server-only` 때문에 클라이언트 컴포넌트에서 import 하면 빌드가 실패한다.
 */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
