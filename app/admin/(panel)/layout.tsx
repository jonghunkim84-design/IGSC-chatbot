import type { Metadata } from "next";
import Script from "next/script";
import { NavLinks } from "@/components/admin/NavLinks";
import { requireAdmin } from "@/lib/admin/guard";
import { ensureCertNames } from "@/lib/cert-registry";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "IGSC 챗봇 관리자",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireAdmin();
  await ensureCertNames(); // 인증 종류(DB, 10분 캐시)를 이 서버에 반영: 하위 화면의 선택지·표시 이름이 최신 값을 쓴다
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900" style={{ colorScheme: "light" }}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4">
            <span className="py-2 text-sm font-bold text-teal-800">IGSC 챗봇 관리자</span>
            <NavLinks />
          </div>
          <form action={logoutAction} className="flex items-center gap-2">
            <span className="hidden max-w-[220px] truncate text-xs text-slate-500 sm:inline" title={email}>
              {email}
            </span>
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      {/* 관리자도 고객과 같은 챗봇 위젯으로 직접 물어볼 수 있다 (오른쪽 아래 버튼). 이 질문도 대화 로그·미답변 목록에 기록된다. */}
      <Script src="/widget.js" strategy="afterInteractive" />
    </div>
  );
}
