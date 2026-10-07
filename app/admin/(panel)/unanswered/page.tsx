import Link from "next/link";
import { NeedsInputBadge, PageTitle, Pagination, btnGhost, btnPrimary, inputCls } from "@/components/admin/ui";
import { listCertNames } from "@/lib/cert-names";
import { formatKst } from "@/lib/admin/labels";
import { findDraftsForUnanswered } from "@/lib/db/admin-doc-draft";
import { listUnansweredAdmin } from "@/lib/db/admin-unanswered";
import { MAX_BULK_DRAFTS } from "@/lib/docs/draft-service";
import { AutoRefresh } from "../documents/RowActions";
import { resolveUnansweredAction } from "../actions";
import { draftBulkAction, draftOneAction } from "./actions";

export const dynamic = "force-dynamic";
// [초안 만들기]는 문서를 읽고 Claude 를 호출하므로 시간이 걸린다
export const maxDuration = 60;

type SP = { view?: string; kind?: string; page?: string; msg?: string; fid?: string; file?: string; n?: string; skipped?: string; ids?: string };

const TABS: [string, string][] = [
  ["open", "미처리"],
  ["resolved", "처리 완료"],
  ["all", "전체"],
];

const KINDS: [string, string][] = [
  ["all", "전체 유형"],
  ["partial", "부분 안내"],
  ["none", "전혀 못 답함"],
];

function flashFor(sp: SP): { text: React.ReactNode; tone: "ok" | "warn" } | null {
  const link = sp.fid ? (
    <Link href={`/admin/faq/${sp.fid}`} className="ml-1 font-semibold underline">
      초안 열기 →
    </Link>
  ) : null;
  switch (sp.msg) {
    case "draft_drafted":
      return { text: <>문서에서 근거를 찾아 초안을 만들었습니다. 출처: {sp.file ?? "-"} (초안 상태이며 승인 전에는 챗봇에 나가지 않습니다) {link}</>, tone: "ok" };
    case "draft_not_found":
      return { text: <>문서에서 근거를 찾지 못했습니다. 빈 답변의 &lsquo;보완 필요&rsquo; 초안으로 만들었습니다. 담당자가 직접 채워 주세요. {link}</>, tone: "warn" };
    case "draft_rejected":
      return { text: <>근거 검증을 통과하지 못해 초안을 버리고, 빈 답변의 &lsquo;보완 필요&rsquo; 초안으로 만들었습니다. 담당자가 직접 채워 주세요. {link}</>, tone: "warn" };
    case "draft_blocked":
      return { text: "컨설팅성 요청이라 초안을 만들지 않았습니다. 인증기관은 심사 대상에게 컨설팅을 제공할 수 없습니다(ISO 17065 공평성). 이 질문은 담당자가 직접 판단해 주세요.", tone: "warn" };
    case "draft_no_docs":
      return { text: <>텍스트 추출이 끝난 문서가 없습니다. 문서 보관함에서 문서를 올리고 &lsquo;추출 완료&rsquo;가 된 뒤 다시 시도해 주세요.</>, tone: "warn" };
    case "draft_exists":
      return { text: <>이미 이 질문에서 만든 초안이 있습니다. {link}</>, tone: "warn" };
    case "draft_none":
      return { text: "초안을 만들 질문을 먼저 선택해 주세요.", tone: "warn" };
    case "draft_bulk":
      return {
        text: `${sp.n}건의 초안 만들기를 시작했습니다. 문서를 읽는 데 시간이 걸리며, 끝나면 아래 목록에 '초안 있음'으로 나타납니다.${Number(sp.skipped) > 0 ? ` (한 번에 최대 ${MAX_BULK_DRAFTS}건이라 ${sp.skipped}건은 제외했습니다)` : ""}`,
        tone: "ok",
      };
    case "draft_error":
    case "draft_missing":
      return { text: "초안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", tone: "warn" };
    default:
      return null;
  }
}

export default async function UnansweredPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = sp.view === "resolved" || sp.view === "all" ? sp.view : "open";
  const kind = sp.kind === "partial" || sp.kind === "none" ? sp.kind : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listUnansweredAdmin({
    resolved: view === "all" ? undefined : view === "resolved",
    page,
    kind: kind === "all" ? undefined : kind,
  });
  const hrefFor = (v: string, k: string) => {
    const qs = new URLSearchParams();
    if (v !== "open") qs.set("view", v);
    if (k !== "all") qs.set("kind", k);
    const s = qs.toString();
    return `/admin/unanswered${s ? `?${s}` : ""}`;
  };
  const drafts = await findDraftsForUnanswered(rows.map((r) => r.id));
  const returnTo = hrefFor(view, kind);
  const flash = flashFor(sp);

  // 일괄 실행 후 아직 초안이 만들어지지 않은 질문 (만드는 중)
  const drafting = new Set((sp.ids ?? "").split(",").filter(Boolean));
  const stillDrafting = rows.filter((r) => drafting.has(r.id) && !drafts.has(r.id)).map((r) => r.id);
  const draftable = (id: string, resolved: boolean) => !resolved && !drafts.has(id) && !stillDrafting.includes(id);

  return (
    <>
      <AutoRefresh active={stillDrafting.length > 0} />
      <PageTitle title="미답변 질문" />
      <p className="mb-3 text-sm text-slate-600">챗봇이 답하지 못하고 담당자에게 넘긴 질문입니다. 최신순으로 보여줍니다.</p>
      {flash && (
        <p role="status" className={`mb-4 rounded-lg border px-3 py-2 text-sm ${flash.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {flash.text}
        </p>
      )}

      <div className="mb-4 flex gap-1" role="tablist" aria-label="처리 상태">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={hrefFor(key, kind)}
            role="tab"
            aria-selected={view === key}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === key ? "bg-teal-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1" role="group" aria-label="유형">
        {KINDS.map(([key, label]) => (
          <Link
            key={key}
            href={hrefFor(view, key)}
            aria-current={kind === key ? "true" : undefined}
            className={`rounded-md px-3 py-1 text-xs font-medium ${kind === key ? "bg-indigo-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {label}
          </Link>
        ))}
        <span className="ml-2 text-xs text-slate-500">부분 안내 = 챗봇이 FAQ 범위까지는 안내하고 나머지를 담당자 확인으로 넘긴 질문</span>
      </div>

      {/* 초안 만들기 도구: 체크박스·버튼은 form="draft-form" 속성으로 이 폼에 연결된다 (행마다 다른 폼이 있어 중첩을 피함) */}
      <form id="draft-form" className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="text-xs font-medium text-slate-600">
          문서에서 찾을 인증 종류 (선택)
          <select name="certType" defaultValue="" className={`${inputCls} mt-1 min-w-[220px]`}>
            <option value="">전체 문서에서 찾기</option>
            {listCertNames().map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" formAction={draftBulkAction} className={btnPrimary}>
          선택 항목 초안 만들기
        </button>
        <p className="basis-full text-xs text-slate-500">
          업로드한 문서에서 근거를 찾아 <b>초안(draft)</b>을 만듭니다. 근거를 못 찾으면 빈 답변의 &lsquo;보완 필요&rsquo; 초안이 됩니다. 승인은 항상 사람이 합니다. 한 번에 최대 {MAX_BULK_DRAFTS}건, 자동 실행(야간 배치)은 없습니다.
        </p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="w-36 px-3 py-2">일시</th>
              <th className="px-3 py-2">질문</th>
              <th className="w-28 px-3 py-2">상태</th>
              <th className="w-72 px-3 py-2">처리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  {view === "open" ? "처리할 미답변 질문이 없습니다." : "해당하는 질문이 없습니다."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const d = drafts.get(r.id);
              const canDraft = draftable(r.id, r.resolved);
              return (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <input type="checkbox" name="ids" value={r.id} form="draft-form" disabled={!canDraft} aria-label={`${r.question} 선택`} className="mt-0.5 h-4 w-4 disabled:opacity-30" />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatKst(r.created_at)}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.question}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${r.resolved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        {r.resolved ? "처리 완료" : "미처리"}
                      </span>
                      {r.partial && <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800" title="챗봇이 FAQ 범위까지는 안내했고, 나머지는 담당자 확인이 필요합니다">부분 안내</span>}
                      {d && <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">초안 있음</span>}
                      {d?.needs_input && <NeedsInputBadge />}
                      {d?.needs_input && d.draft_note && <span className="max-w-[16rem] text-xs text-amber-900">사유: {d.draft_note}</span>}
                      {!d && stillDrafting.includes(r.id) && <span className="text-xs text-slate-500">초안 만드는 중…</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {d ? (
                        <Link href={`/admin/faq/${d.id}`} className={`${btnPrimary} !px-3 !py-1.5`}>
                          검수하기
                        </Link>
                      ) : (
                        !r.resolved && (
                          <>
                            <button type="submit" form="draft-form" formAction={draftOneAction.bind(null, r.id)} disabled={!canDraft} className={`${btnPrimary} !px-3 !py-1.5 disabled:opacity-50`}>
                              초안 만들기
                            </button>
                            <Link href={`/admin/faq/new?unanswered=${r.id}`} className={`${btnGhost} !px-3 !py-1.5`}>
                              직접 등록
                            </Link>
                          </>
                        )
                      )}
                      <form action={resolveUnansweredAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="resolved" value={r.resolved ? "false" : "true"} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <button type="submit" className={`${btnGhost} !px-3 !py-1.5`}>
                          {r.resolved ? "미처리로 되돌리기" : "처리 완료"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination basePath="/admin/unanswered" params={{ view: view === "open" ? undefined : view, kind: kind === "all" ? undefined : kind }} page={page} total={total} />
    </>
  );
}
