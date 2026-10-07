import { PageTitle } from "@/components/admin/ui";
import { collectSignals } from "@/lib/monitor/collect";
import { evaluate, overall } from "@/lib/monitor/evaluate";

export const dynamic = "force-dynamic";

const LEVEL_STYLE = {
  ok: { label: "정상", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  warning: { label: "주의", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  critical: { label: "긴급", cls: "bg-red-50 text-red-800 border-red-200" },
} as const;

function Row({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <tr className="border-t border-slate-100 first:border-0">
      <td className="py-2 font-medium text-slate-800">{name}</td>
      <td className="py-2">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{ok ? "정상" : "이상"}</span>
      </td>
      <td className="py-2 text-xs text-slate-500">{detail}</td>
    </tr>
  );
}

export default async function StatusPage() {
  const s = await collectSignals({ forceAi: true });
  const issues = evaluate(s);
  const st = LEVEL_STYLE[overall(issues)];
  const errRate = s.lastHour.total ? `${Math.round((s.lastHour.errors / s.lastHour.total) * 100)}%` : "-";
  return (
    <div className="space-y-4">
      <PageTitle title="운영 상태" />
      <div className={`rounded-xl border p-4 ${st.cls}`}>
        <p className="text-lg font-bold">현재 상태: {st.label}</p>
        {issues.length === 0 ? (
          <p className="mt-1 text-sm">확인된 문제가 없습니다.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {issues.map((i) => (
              <li key={i.code}>
                <span className="font-semibold">{i.level === "critical" ? "긴급" : "주의"}</span> · {i.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">연결 점검 (지금 확인한 결과)</h3>
        <table className="w-full text-sm">
          <tbody>
            <Row name="데이터베이스" ok={s.dbOk} detail={s.dbError} />
            <Row name="AI (Claude API)" ok={s.aiOk} detail={s.aiError} />
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["최근 1시간 대화", `${s.lastHour.total.toLocaleString("ko-KR")}건`, `오류 이관 ${s.lastHour.errors}건 (${errRate})`],
          ["오늘 질문 수", `${s.daily.used.toLocaleString("ko-KR")}건`, `하루 상한 ${s.daily.cap.toLocaleString("ko-KR")}건`],
          ["승인된 FAQ", `${s.approvedFaq.toLocaleString("ko-KR")}건`, "0건이면 챗봇이 답하지 못함"],
          ["미답변 대기", `${s.openUnanswered.toLocaleString("ko-KR")}건`, "처리 전 질문"],
        ].map(([t, v, n]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-600">{t}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{v}</p>
            <p className="mt-2 text-xs text-slate-500">{n}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">이 화면은 열 때마다 AI 연결을 실제로 한 번 호출해 확인합니다. 자동 점검은 하루 1회(오전 9시) 실행되고, 문제가 있으면 관리자 이메일로 알림이 전달됩니다 (docs/monitoring.md).</p>
    </div>
  );
}
