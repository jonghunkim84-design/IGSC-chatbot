import Link from "next/link";
import { PageTitle, Pagination, RouteBadge, StatusBadge, btnGhost, btnPrimary, inputCls } from "@/components/admin/ui";
import { ROUTE_LABELS, ROUTE_ORDER, formatKst } from "@/lib/admin/labels";
import { channelLabel } from "@/lib/channels";
import { listChatLogs } from "@/lib/db/admin-logs";

export const dynamic = "force-dynamic";

type SP = { from?: string; to?: string; route?: string; page?: string };

export default async function LogsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const route = sp.route && sp.route in ROUTE_LABELS ? sp.route : undefined;
  const { rows, total, faqQuestions } = await listChatLogs({ from: sp.from, to: sp.to, route, page });

  return (
    <>
      <PageTitle title="대화 로그" />

      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="text-xs font-medium text-slate-600">
          시작일
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          종료일
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          처리 결과
          <select name="route" defaultValue={route ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {ROUTE_ORDER.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>
            검색
          </button>
          <Link href="/admin/logs" className={btnGhost}>
            초기화
          </Link>
        </div>
      </form>

      <ul className="space-y-2">
        {rows.length === 0 && <li className="rounded-xl border border-slate-200 bg-white px-3 py-10 text-center text-sm text-slate-500">조건에 맞는 대화가 없습니다.</li>}
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white">
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-slate-50">
                <span className="w-32 shrink-0 text-xs text-slate-500">{formatKst(r.created_at)}</span>
                <RouteBadge route={r.route} />
                {r.source && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600" title="유입 채널">{channelLabel(r.source)}{r.source_detail ? ` · ${r.source_detail}` : ""}</span>}
                <span className="min-w-0 flex-1 basis-64 font-medium text-slate-900">{r.question}</span>
                <span className="text-xs text-slate-500">근거 FAQ {r.matched_faq_ids?.length ?? 0}건 ▾</span>
              </summary>
              <div className="space-y-3 border-t border-slate-100 px-3 py-3 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">챗봇 응답</p>
                  <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-slate-800">{r.answer || "(응답 없음)"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">근거 FAQ</p>
                  {(r.matched_faq_ids?.length ?? 0) === 0 ? (
                    <p className="text-slate-500">근거로 사용한 FAQ가 없습니다.</p>
                  ) : (
                    <ul className="space-y-1">
                      {r.matched_faq_ids.map((id) => {
                        const f = faqQuestions.get(id);
                        return (
                          <li key={id} className="flex flex-wrap items-center gap-2">
                            {f ? (
                              <>
                                <Link href={`/admin/faq/${id}`} className="font-medium text-teal-800 hover:underline">
                                  {f.question}
                                </Link>
                                <StatusBadge status={f.status} />
                              </>
                            ) : (
                              <span className="text-slate-500">삭제된 FAQ ({id.slice(0, 8)})</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <p className="text-xs text-slate-400">세션 {r.session_id.slice(0, 8)}</p>
              </div>
            </details>
          </li>
        ))}
      </ul>

      <Pagination basePath="/admin/logs" params={{ from: sp.from, to: sp.to, route }} page={page} total={total} />
    </>
  );
}
