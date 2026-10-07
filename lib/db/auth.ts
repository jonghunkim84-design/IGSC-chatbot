import "server-only";
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 관리자 로그인용 Supabase Auth 클라이언트 (anon key + 쿠키 세션).
 * 서버 컴포넌트/서버 액션/라우트 핸들러에서 쓴다. 데이터 조회는 lib/db/admin-*.ts (service role) 가 담당한다.
 */
export async function createAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다.");
  const store = await cookies();
  return createSsrClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 미들웨어가 처리한다.
        }
      },
    },
  });
}
