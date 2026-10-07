import { createClient } from "@supabase/supabase-js";

/**
 * 브라우저용 클라이언트 (anon key, RLS 적용).
 * 클라이언트 컴포넌트에서 사용 가능. 서버 전용 클라이언트는 lib/db/server.ts 참고.
 */
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 설정되지 않았습니다.",
    );
  }
  return createClient(url, anonKey);
}
