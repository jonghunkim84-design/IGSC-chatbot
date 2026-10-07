import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/admin/access";

/** /admin 과 /api/admin 전체를 보호한다 (로그인 관련 경로만 예외). */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() 는 토큰을 Supabase에 검증한다 (쿠키만 믿지 않는다).
  const { data } = await supabase.auth.getUser();
  const decision = decideAccess(pathname, data.user?.email);
  if (decision === "allow") return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: decision === "forbidden" ? "forbidden" : "unauthorized" }, { status: decision === "forbidden" ? 403 : 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = decision === "forbidden" ? "?error=forbidden" : "";
  const redirect = NextResponse.redirect(url);
  if (decision === "forbidden") {
    // 허용되지 않은 계정의 세션은 남겨두지 않는다
    for (const c of request.cookies.getAll()) if (c.name.startsWith("sb-")) redirect.cookies.delete(c.name);
  }
  return redirect;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
