import Link from "next/link";
import { Flash, NeedsInputBadge, PageTitle, Pagination, StatusBadge, btnGhost, btnPrimary, inputCls } from "@/components/admin/ui";
import { SelectAll } from "@/components/admin/SelectAll";
import { DeleteSelectedButton } from "@/components/admin/DeleteSelectedButton";
import { CERT_NAMES, hasCertName } from "@/lib/cert-names";
import { CATEGORY_LABELS, STATUS_LABELS, formatKst } from "@/lib/admin/labels";
import { listFaqCertTypes, listFaqs } from "@/lib/db/admin-faq";
import { bulkApproveAction, bulkDeleteAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { cert?: string; cat?: string; status?: string; q?: string; page?: string; review?: string; msg?: string; ok?: string; skip?: string };

const certLabel = (slug: string) => (hasCertName(slug) ? CERT_NAMES[slug] : `${slug} (미등록)`);

function flashFor(sp: SP): { text: string; tone: "ok" | "warn" } | null {
  switch (sp.msg) {
    case "saved":
      return { text: "저장했습니다. 챗봇 답변에 바로 반영됩니다.", tone: "ok" };
    case "approved": {
      const skip = Number(sp.skip ?? 0);
      return {
        text: `${sp.ok ?? 0}건을 승인했습니다.${skip ? ` 답변이 비었거나 '보완 필요' 표시가 있는 ${skip}건은 승인하지 않았습니다.` : ""}`,
        tone: skip ? "warn" : "ok",
      };
    }
    case "approved_one":
      return { text: "승인했습니다. 챗봇 답변에 바로 반영됩니다.", tone: "ok" };
    case "deleted":
      return { text: "초안을 삭제했습니다.", tone: "ok" };
    case "bulk_deleted": {
      const skip = Number(sp.skip ?? 0);
      return {
        text: `초안 ${sp.ok ?? 0}건을 삭제했습니다.${skip ? ` 승인된 FAQ이거나 이미 없는 ${skip}건은 삭제하지 않았습니다.` : ""}`,
        tone: skip ? "warn" : "ok",
      };
    }
    case "none_delete":
      return { text: "삭제할 항목을 먼저 선택해 주세요.", tone: "warn" };
    case "review_done":
      return { text: "재검토를 마쳤습니다. 이 FAQ는 계속 서비스됩니다.", tone: "ok" };
    case "none":
      return { text: "승인할 항목을 먼저 선택해 주세요.", tone: "warn" };
    case "error":
      return { text: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", tone: "warn" };
    default:
      return null;
  }
}

export default async function FaqListPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, certTypes] = await Promise.all([
    listFaqs({ certType: sp.cert, category: sp.cat, status: sp.status, q: sp.q, review: sp.review === "1", page }),
    listFaqCertTypes(),
  ]);
  const flash = flashFor(sp);
  const filterParams = { cert: sp.cert, cat: sp.cat, status: sp.status, q: sp.q, review: sp.review === "1" ? "1" : undefined };
  const rp = new URLSearchParams();
  for (const [k, v] of Object.entries(filterParams)) if (v) rp.set(k, v);
  if (page > 1) rp.set("page", String(page));
  const returnTo = rp.size ? `/admin/faq?${rp}` : "/admin/faq";

  return (
    <>
      <PageTitle title="FAQ">
        <Link href="/admin/faq/new" className={btnPrimary}>
          + FAQ 등록
        </Link>
      </PageTitle>
      <Flash message={flash?.text} tone={flash?.tone} />

      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto]">
        <label className="text-xs font-medium text-slate-600">
          인증 종류
          <select name="cert" defaultValue={sp.cert ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {certTypes.map((c) => (
              <option key={c} value={c}>
                {c === "common" ? "공통" : certLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          카테고리
          <select name="cat" defaultValue={sp.cat ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          상태
          <select name="status" defaultValue={sp.status ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          키워드 (질문·답변)
          <input name="q" defaultValue={sp.q ?? ""} placeholder="예: 비건 원칙" className={`${inputCls} mt-1`} />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-slate-600">
            <input type="checkbox" name="review" value="1" defaultChecked={sp.review === "1"} className="h-4 w-4" />
            재검토 필요만
          </label>
          <button type="submit" className={btnPrimary}>
            검색
          </button>
          <Link href="/admin/faq" className={btnGhost}>
            초기화
          </Link>
        </div>
      </form>

      <form action={bulkApproveAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="w-10 px-3 py-2">
                  <SelectAll />
                </th>
                <th className="w-28 px-3 py-2">상태</th>
                <th className="px-3 py-2">질문</th>
                <th className="w-44 px-3 py-2">인증 종류</th>
                <th className="w-24 px-3 py-2">카테고리</th>
                <th className="w-36 px-3 py-2">수정일</th>
                <th className="w-44 px-3 py-2">승인자</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    조건에 맞는 FAQ가 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const selectable = r.status !== "approved"; // 승인 건너뜀·삭제 제한은 서버가 다시 거른다
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name="ids"
                        value={r.id}
                        disabled={!selectable}
                        aria-label={`${r.question} 선택`}
                        title={selectable ? undefined : "승인된 FAQ는 선택할 수 없습니다 (내리려면 상태를 '초안'으로 바꿔 저장)"}
                        className="mt-0.5 h-4 w-4 disabled:opacity-30"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={r.status} />
                        {r.needs_input && <NeedsInputBadge />}
                        {r.needs_review && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">재검토 필요</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/faq/${r.id}?back=${encodeURIComponent(returnTo)}`} className="line-clamp-2 font-medium text-slate-900 hover:text-teal-800 hover:underline">
                        {r.question}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.cert_type === "common" ? "공통" : certLabel(r.cert_type)}</td>
                    <td className="px-3 py-2 text-slate-700">{CATEGORY_LABELS[r.category] ?? r.category}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatKst(r.updated_at)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {r.status !== "approved" ? (
                        "-"
                      ) : r.approved_by ? (
                        <>
                          <span className="block max-w-[10rem] truncate" title={r.approved_by}>
                            {r.approved_by}
                          </span>
                          {r.approved_at && <span className="text-slate-400">{formatKst(r.approved_at)}</span>}
                        </>
                      ) : (
                        <span className="text-slate-400">기록 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className={btnPrimary}>
            선택 항목 승인
          </button>
          <DeleteSelectedButton action={bulkDeleteAction} />
          <span className="text-xs text-slate-500">승인은 답변이 비었거나 &lsquo;보완 필요&rsquo; 표시가 있는 항목을 건너뜁니다. 삭제는 초안만 가능하고 되돌릴 수 없습니다.</span>
        </div>
      </form>

      <Pagination basePath="/admin/faq" params={filterParams} page={page} total={total} />
    </>
  );
}
