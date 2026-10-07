import Link from "next/link";
import { DOC_STATUS_LABELS, PAGE_SIZE, ROUTE_LABELS, STATUS_LABELS } from "@/lib/admin/labels";

const ROUTE_STYLES: Record<string, string> = {
  answered: "bg-emerald-100 text-emerald-800",
  handoff: "bg-amber-100 text-amber-800",
  clarify: "bg-sky-100 text-sky-800",
  consulting_blocked: "bg-violet-100 text-violet-800",
  complaint: "bg-rose-100 text-rose-800",
  out_of_scope: "bg-slate-200 text-slate-700",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700";
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{STATUS_LABELS[status] ?? status}</span>;
}

const DOC_STATUS_STYLES: Record<string, string> = {
  pending: "bg-sky-100 text-sky-800",
  extracted: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  archived: "bg-slate-200 text-slate-700",
};

export function DocStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${DOC_STATUS_STYLES[status] ?? "bg-slate-200 text-slate-700"}`}>
      {DOC_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function NeedsInputBadge() {
  return <span className="inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">보완 필요</span>;
}

export function RouteBadge({ route }: { route: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ROUTE_STYLES[route] ?? "bg-slate-200 text-slate-700"}`}>
      {ROUTE_LABELS[route] ?? route}
    </span>
  );
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      {children}
    </div>
  );
}

export function Flash({ message, tone = "ok" }: { message?: string | null; tone?: "ok" | "warn" }) {
  if (!message) return null;
  const cls = tone === "warn" ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-emerald-50 text-emerald-900 border-emerald-200";
  return (
    <p role="status" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      {message}
    </p>
  );
}

/** 현재 필터를 유지하는 페이지네이션. 총 건수와 함께 표시한다. */
export function Pagination({
  basePath,
  params,
  page,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const nums: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p++) nums.push(p);
  const link = "rounded-md border px-3 py-1.5 text-sm";

  return (
    <nav aria-label="페이지 이동" className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-slate-600">
        총 <b>{total.toLocaleString("ko-KR")}</b>건 · {page}/{pages} 페이지
      </p>
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 && (
            <Link href={href(page - 1)} className={`${link} border-slate-300 bg-white hover:bg-slate-50`}>
              이전
            </Link>
          )}
          {nums.map((p) => (
            <Link
              key={p}
              href={href(p)}
              aria-current={p === page ? "page" : undefined}
              className={`${link} ${p === page ? "border-teal-700 bg-teal-700 font-semibold text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              {p}
            </Link>
          ))}
          {page < pages && (
            <Link href={href(page + 1)} className={`${link} border-slate-300 bg-white hover:bg-slate-50`}>
              다음
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";
export const btnPrimary = "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50";
export const btnGhost = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50";
