import Link from "next/link";
import { PageTitle, RouteBadge } from "@/components/admin/ui";
import { countNeedsReview } from "@/lib/db/admin-faq-review";
import { getDashboardStats, type PeriodStats } from "@/lib/db/admin-stats";
import { ROUTE_ORDER, addDaysYmd, kstTodayYmd, kstWeekStartYmd } from "@/lib/admin/labels";

export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r === null ? "-" : `${(r * 100).toFixed(1)}%`);

function Card({ title, sub, value, note, href }: { title: string; sub?: string; value: string; note?: string; href?: string }) {
  const body = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function RouteTable({ label, s }: { label: string; s: PeriodStats }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{label} 처리 결과</h3>
      <table className="w-full text-sm">
        <tbody>
          {ROUTE_ORDER.map((r) => (
            <tr key={r} className="border-t border-slate-100 first:border-0">
              <td className="py-1.5">
                <RouteBadge route={r} />
              </td>
              <td className="py-1.5 text-right tabular-nums">{(s.byRoute[r] ?? 0).toLocaleString("ko-KR")}건</td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 font-semibold">
            <td className="py-1.5">합계</td>
            <td className="py-1.5 text-right tabular-nums">{s.total.toLocaleString("ko-KR")}건</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function DashboardPage() {
  const s = await getDashboardStats();
  // 대시보드 전체가 이 숫자 때문에 죽지 않게 한다 (마이그레이션 전이거나 일시 오류여도 나머지는 보여준다)
  const needsReview = await countNeedsReview().catch((err) => {
    console.error("[admin] 재검토 필요 건수 조회 실패:", err);
    return 0;
  });
  const today = kstTodayYmd();
  const weekStart = kstWeekStartYmd();

  return (
    <>
      <PageTitle title="대시보드" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="오늘 문의" value={`${s.today.total.toLocaleString("ko-KR")}건`} sub={today} note={`답변 성공률 ${pct(s.today.successRate)}`} />
        <Card
          title="이번 주 문의"
          value={`${s.week.total.toLocaleString("ko-KR")}건`}
          sub={`${weekStart} ~ ${addDaysYmd(weekStart, 6)}`}
          note={`답변 성공률 ${pct(s.week.successRate)}`}
        />
        <Card title="이번 주 답변 성공률" value={pct(s.week.successRate)} note="답변 완료 ÷ (답변 완료 + 담당자 이관)" />
        <Card title="미처리 미답변 질문" value={`${s.openUnanswered.toLocaleString("ko-KR")}건`} note="FAQ 등록 또는 처리 완료가 필요합니다" href="/admin/unanswered" />
      </div>

      {needsReview > 0 && (
        <Link href="/admin/faq?review=1" className="mt-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 hover:bg-amber-100">
          <span className="text-sm font-semibold text-amber-950">재검토 필요 {needsReview.toLocaleString("ko-KR")}건</span>
          <span className="text-xs text-amber-900">출처 문서가 개정·삭제된 FAQ입니다. 승인 상태로 계속 서비스 중 →</span>
        </Link>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <RouteTable label="오늘" s={s.today} />
        <RouteTable label="이번 주" s={s.week} />
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-base font-bold text-slate-900">많이 묻는 질문 Top 10 <span className="text-xs font-normal text-slate-500">(최근 30일, 같은 문장 기준)</span></h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="w-12 px-3 py-2">순위</th>
                <th className="px-3 py-2">질문</th>
                <th className="w-20 px-3 py-2 text-right">횟수</th>
                <th className="w-36 px-3 py-2">주된 처리</th>
              </tr>
            </thead>
            <tbody>
              {s.topQuestions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                    아직 문의가 없습니다.
                  </td>
                </tr>
              )}
              {s.topQuestions.map((q, i) => (
                <tr key={q.question} className="border-t border-slate-100">
                  <td className="px-3 py-2 tabular-nums text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2">{q.question}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{q.count}</td>
                  <td className="px-3 py-2">
                    <RouteBadge route={q.topRoute} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="mt-4 text-xs text-slate-500">기준: 한국 시간(KST), 이번 주는 월요일부터. 문의 수는 챗봇에 입력된 질문 1건(버튼 선택 포함)마다 1로 셉니다.</p>
    </>
  );
}
