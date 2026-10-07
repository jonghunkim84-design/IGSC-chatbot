"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin", label: "대시보드", exact: true },
  { href: "/admin/faq", label: "FAQ" },
  { href: "/admin/unanswered", label: "미답변 질문" },
  { href: "/admin/logs", label: "대화 로그" },
  { href: "/admin/channels", label: "유입 채널" },
  { href: "/admin/documents", label: "문서 보관함" },
  { href: "/admin/cert-types", label: "인증 종류" },
  { href: "/admin/status", label: "운영 상태" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="관리자 메뉴" className="flex gap-1 overflow-x-auto">
      {ITEMS.map((it) => {
        const active = it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-teal-700 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
