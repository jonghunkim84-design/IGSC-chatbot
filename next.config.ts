import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 모든 경로 공통 보안 헤더
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // /chat 과 /admin 을 뺀 나머지 페이지는 다른 사이트의 프레임 안에서 열리지 않는다
        source: "/((?!chat$|admin).*)",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
      },
      {
        // /chat 은 고객사 사이트의 iframe 안에서 열린다. 허용할 사이트를 좁히려면
        // 환경변수 CHAT_FRAME_ANCESTORS 에 공백 구분 목록으로 지정한다 (예: "https://a.co.kr https://*.b.com").
        source: "/chat",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${process.env.CHAT_FRAME_ANCESTORS?.trim() || "*"}`,
          },
        ],
      },
      {
        // 관리자 화면은 다른 사이트에 프레임으로 삽입될 수 없다 (클릭재킹 방지)
        source: "/admin/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    // 개발용 위젯 테스트 페이지(public/widget-test.html)는 운영에서 404 처리
    return isProd
      ? { beforeFiles: [{ source: "/widget-test.html", destination: "/__not-found" }], afterFiles: [], fallback: [] }
      : { beforeFiles: [], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
