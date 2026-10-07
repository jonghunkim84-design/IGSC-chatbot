import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "관리자 로그인", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  forbidden: "이 이메일은 관리자로 등록되어 있지 않습니다.",
  link: "로그인 링크가 만료되었거나 올바르지 않습니다. 메일을 요청한 같은 브라우저에서 링크를 열어 주세요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4" style={{ colorScheme: "light" }}>
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold text-slate-900">IGSC 챗봇 관리자</h1>
        <p className="mt-1 text-sm text-slate-600">등록된 이메일 주소로 로그인 링크를 보내드립니다.</p>
        {error && ERRORS[error] && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {ERRORS[error]}
          </p>
        )}
        <LoginForm />
      </div>
    </div>
  );
}
