import { headers } from "next/headers";
import Link from "next/link";
import { PageTitle, btnGhost, btnPrimary } from "@/components/admin/ui";
import { addDaysYmd, kstDayStartISO, kstTodayYmd } from "@/lib/admin/labels";
import { aggregateChannels } from "@/lib/admin/channel-stats";
import { channelLabel } from "@/lib/channels";
import { listChannelRows } from "@/lib/db/admin-channels";
import { ChannelLinks } from "./ChannelLinks";

export const dynamic = "force-dynamic";

const RANGES = [
  { key: "today", label: "오늘", days: 0 },
  { key: "7d", label: "최근 7일", days: 6 },
  { key: "30d", label: "최근 30일", days: 29 },
  { key: "all", label: "전체", days: null },
] as const;

const pct = (r: number | null) => (r === null ? "-" : `${(r * 100).toFixed(0)}%`);

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[2];
  const since = range.days === null ? null : kstDayStartISO(addDaysYmd(kstTodayYmd(), -range.days));
  const result = await listChannelRows(since);

  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <>
      <PageTitle title="유입 채널" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">기간</span>
        {RANGES.map((r) => (
          <Link key={r.key} href={`/admin/channels?range=${r.key}`} className={r.key === range.key ? btnPrimary : btnGhost}>
            {r.label}
          </Link>
        ))}
      </div>

      {!result.ok ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          채널을 기록하는 항목이 아직 데이터베이스에 없습니다. <b>supabase/migrations/0012_chat_log_source.sql</b> 을 Supabase SQL Editor 에서 실행하면 집계가 시작됩니다. (실행 전의 대화는 채널을 알 수 없어 집계되지 않습니다.)
        </div>
      ) : (
        <Stats rows={result.rows} />
      )}

      <div className="mt-6">
        <ChannelLinks origin={origin} />
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600">
        <p className="mb-1 font-semibold text-slate-800">집계 기준과 한계</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>질문 수</b>는 챗봇에 입력된 메시지 1건마다 1, <b>대화 수</b>는 질문을 한 방문(브라우저 탭)의 수입니다. 챗봇을 열기만 하고 질문하지 않은 방문은 집계되지 않습니다.
          </li>
          <li>링크에 채널 표시(?src=)가 없으면 이전 페이지 주소로 짐작하고(블로그·링크드인·인스타그램), 짐작할 수 없으면 &lsquo;직접 입력·알 수 없음&rsquo;으로 집계됩니다.</li>
          <li>링크 단축 서비스가 뒤의 주소를 지우거나, 브라우저가 이전 페이지 정보를 주지 않으면 &lsquo;직접 입력·알 수 없음&rsquo;에 들어갑니다. 단축 링크를 쓸 때는 완성된 링크(?src= 포함)를 단축하세요.</li>
          <li>홈페이지의 챗봇 버튼(위젯)은 자동으로 &lsquo;홈페이지&rsquo;로 기록됩니다. 날짜는 한국 시간 기준입니다.</li>
        </ul>
      </div>
    </>
  );
}

function Stats({ rows }: { rows: Parameters<typeof aggregateChannels>[0] }) {
  const { stats, total } = aggregateChannels(rows);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-600">질문 수 (전체)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{total.questions.toLocaleString("ko-KR")}건</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium text-slate-600">대화 수 (전체)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{total.sessions.toLocaleString("ko-KR")}건</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">채널</th>
              <th className="px-3 py-2 text-right">대화 수</th>
              <th className="px-3 py-2 text-right">질문 수</th>
              <th className="px-3 py-2 text-right">비중</th>
              <th className="px-3 py-2 text-right">답변 완료</th>
              <th className="px-3 py-2 text-right">담당자 이관</th>
              <th className="px-3 py-2 text-right">불만</th>
              <th className="px-3 py-2 text-right">답변 성공률</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.source} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium text-slate-900">
                  {channelLabel(s.source)}
                  {s.campaigns.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs font-normal text-slate-500">
                      {s.campaigns.map((c) => (
                        <li key={c.name}>
                          └ {c.name}: 질문 {c.questions}건 · 대화 {c.sessions}건
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.sessions}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{s.questions}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <div className="ml-auto flex w-24 items-center justify-end gap-2">
                    <span className="inline-block h-2 rounded bg-teal-600" style={{ width: `${Math.round(s.share * 48)}px` }} />
                    {pct(s.questions ? s.share : null)}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.answered}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.handoff}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.complaint}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(s.successRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
