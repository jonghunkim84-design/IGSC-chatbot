import Link from "next/link";
import { DocStatusBadge, Flash, PageTitle, Pagination, btnGhost, btnPrimary, inputCls } from "@/components/admin/ui";
import { CERT_NAMES, hasCertName, listCertNames } from "@/lib/cert-names";
import { DOC_CATEGORY_LABELS, DOC_STATUS_LABELS, formatKst } from "@/lib/admin/labels";
import { formatBytes } from "@/lib/admin/documents";
import { countAutoDrafts, latestJobsFor } from "@/lib/db/admin-doc-faq";
import { docReviewCounts } from "@/lib/db/admin-doc-review";
import { listDocuments } from "@/lib/db/admin-documents";
import { checkDocumentForFaq, isApprovalComplete } from "@/lib/docs/doc-faq";
import { DocFaqBulk, DocFaqCell, type JobSummary } from "./DocFaqControls";
import { QaFormatCheck } from "./QaFormatCheck";
import { DocumentUploader } from "./DocumentUploader";
import { AutoRefresh, DeleteButton, ReextractButton, ReextractPendingButton, ReviseButton } from "./RowActions";

export const dynamic = "force-dynamic";
// 업로드 직후 백그라운드 텍스트 추출이 이 시간 안에 끝나야 한다 (문서가 크면 '추출 대기'로 남고 재추출로 다시 실행)
export const maxDuration = 60;

type SP = { status?: string; cert?: string; cat?: string; page?: string; msg?: string; faqs?: string; n?: string };

const certLabel = (slug: string) => (slug === "common" ? "공통" : hasCertName(slug) ? CERT_NAMES[slug] : `${slug} (미등록)`);

function flashFor(sp: SP): { text: string; tone: "ok" | "warn" } | null {
  switch (sp.msg) {
    case "deleted":
      return { text: `삭제했습니다.${Number(sp.faqs) > 0 ? ` 이 문서에서 만든 FAQ ${sp.faqs}건은 남아 있고 출처 문서 연결만 해제되었습니다.` : ""}`, tone: "ok" };
    case "delete_failed":
      return { text: "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", tone: "warn" };
    case "reextract":
      return { text: "텍스트 추출을 시작했습니다. 잠시 후 상태가 바뀝니다.", tone: "ok" };
    case "reextract_pending":
      return { text: Number(sp.n) > 0 ? `추출 대기 문서 ${sp.n}건의 추출을 시작했습니다. 잠시 후 상태가 바뀝니다.` : "추출 대기 중인 문서가 없습니다.", tone: "ok" };
    case "reextract_archived":
      return { text: "이전 버전 문서는 다시 추출하지 않습니다.", tone: "warn" };
    case "error":
      return { text: "처리 중 오류가 발생했습니다.", tone: "warn" };
    default:
      return null;
  }
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, linkedFaqs } = await listDocuments({ status: sp.status, certType: sp.cert, category: sp.cat, page });
  const flash = flashFor(sp);
  const jobs = await latestJobsFor(rows.map((r) => r.id));
  const autoDrafts = await countAutoDrafts(rows.map((r) => r.id)).catch(() => new Map<string, number>());
  const reviewCounts = await docReviewCounts(rows.map((r) => r.id)).catch((err) => {
    console.error("[documents] 초안 현황 조회 실패:", err);
    return new Map<string, { created: number; approved: number; pending: number; held: number }>();
  });

  const certOptions = [{ value: "common", label: "공통 (특정 인증 없음)" }, ...listCertNames().map((c) => ({ value: c.slug, label: c.name }))];
  const categoryOptions = Object.entries(DOC_CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
  const filterParams = { status: sp.status, cert: sp.cert, cat: sp.cat };
  const rp = new URLSearchParams();
  for (const [k, v] of Object.entries(filterParams)) if (v) rp.set(k, v);
  if (page > 1) rp.set("page", String(page));
  const returnTo = rp.size ? `/admin/documents?${rp}` : "/admin/documents";
  const nameById = new Map(rows.map((r) => [r.id, r]));
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <PageTitle title="문서 보관함" />
      <p className="mb-4 text-sm text-slate-600">
        인증·검증 자료를 올려 두는 곳입니다. 이 문서는 FAQ 초안을 만드는 <b>재료</b>로만 쓰이며, 챗봇이 고객에게 답할 때 직접 읽지 않습니다.
      </p>
      <Flash message={flash?.text} tone={flash?.tone} />

      <AutoRefresh active={pendingCount > 0} />
      <DocumentUploader certOptions={certOptions} categoryOptions={categoryOptions} />

      <form method="get" className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="text-xs font-medium text-slate-600">
          인증 종류
          <select name="cert" defaultValue={sp.cert ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {certOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          분류
          <select name="cat" defaultValue={sp.cat ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {categoryOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          상태
          <select name="status" defaultValue={sp.status ?? ""} className={`${inputCls} mt-1`}>
            <option value="">전체</option>
            {Object.entries(DOC_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={btnPrimary}>
            검색
          </button>
          <Link href="/admin/documents" className={btnGhost}>
            초기화
          </Link>
        </div>
      </form>

      {pendingCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span>텍스트 추출을 기다리는 문서가 {pendingCount}건 있습니다. 업로드 직후 자동으로 진행되며, 오래 지속되면 아래 버튼으로 다시 실행하세요.</span>
          <ReextractPendingButton count={pendingCount} returnTo={returnTo} />
        </div>
      )}

      <DocFaqBulk />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2">파일명</th>
              <th className="w-40 px-3 py-2">인증 종류</th>
              <th className="w-24 px-3 py-2">분류</th>
              <th className="w-24 px-3 py-2">버전</th>
              <th className="w-56 px-3 py-2">상태</th>
              <th className="w-32 px-3 py-2">업로드일</th>
              <th className="w-48 px-3 py-2">FAQ 초안</th>
              <th className="w-56 px-3 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                  올려 둔 문서가 없습니다. 위에서 파일을 끌어다 놓아 시작하세요.
                </td>
              </tr>
            )}
            {rows.map((d) => {
              const prev = d.supersedes ? nameById.get(d.supersedes) : undefined;
              const faqCheck = checkDocumentForFaq(d);
              const job = jobs.get(d.id);
              const latest: JobSummary | null = job
                ? { id: job.id, status: job.status, total_chunks: job.total_chunks, done_chunks: job.done_chunks, created_count: job.created_count, replaced_count: job.replaced_count, protected_count: job.protected_count, rejected_count: job.rejected_count, error: job.error, limit_reached: job.limit_reached, error_count: job.error_count }
                : null;
              const drafts = autoDrafts.get(d.id) ?? 0;
              const rc = reviewCounts.get(d.id);
              // FAQ 초안을 만들고 모두 승인한 문서: [FAQ 초안 만들기]를 숨긴다 (바꿀 때는 개정판 올리기 / FAQ 수정)
              const approvalDone = d.status === "extracted" && isApprovalComplete(rc, latest);
              return (
                <tr key={d.id} className={`border-t border-slate-100 align-top ${d.status === "archived" ? "bg-slate-50/60 text-slate-500" : ""}`}>
                  <td className="px-3 py-2">
                    {faqCheck.ok && !approvalDone && (
                      <input
                        type="checkbox"
                        name="gen"
                        value={d.id}
                        form="bulk-gen"
                        data-name={d.file_name}
                        data-again={latest?.status === "done" || drafts > 0 ? "1" : "0"}
                        aria-label={`${d.file_name} 선택`}
                        className="mt-0.5 h-4 w-4"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <p className="break-words font-medium text-slate-900">{d.file_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(d.file_size)}
                      {d.supersedes && <span className="ml-2">· 이전 버전{prev ? ` v${prev.version}` : ""}을 대체</span>}
                    </p>
                  </td>
                  <td className="px-3 py-2">{certLabel(d.cert_type)}</td>
                  <td className="px-3 py-2">
                    {DOC_CATEGORY_LABELS[d.doc_category] ?? d.doc_category}
                    {d.doc_format === "qa_pairs" && <p className="mt-1 text-[11px] font-semibold text-indigo-700">질문·답변 자료</p>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">v{d.version}</td>
                  <td className="px-3 py-2">
                    <DocStatusBadge status={d.status} />
                    {d.status === "extracted" && <p className="mt-1 text-xs text-slate-500">조각 {d.chunk_count}개</p>}
                    {d.status === "failed" && d.failure_reason && (
                      <p role="alert" className="mt-1 max-w-[220px] text-xs leading-snug text-red-700">
                        {d.failure_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatKst(d.created_at)}</td>
                  <td className="px-3 py-2">
                    {d.status === "extracted" && d.doc_format === "qa_pairs" && !d.format_confirmed && <QaFormatCheck docId={d.id} fileName={d.file_name} />}
                    {d.status !== "archived" && !(d.doc_format === "qa_pairs" && !d.format_confirmed) && (
                      <DocFaqCell docId={d.id} fileName={d.file_name} eligible={faqCheck.ok} reason={faqCheck.ok ? undefined : faqCheck.reason} latest={latest} autoDrafts={drafts} completed={approvalDone} />
                    )}
                    {rc && rc.created > 0 && (
                      <div className="mt-2 text-xs text-slate-600">
                        <p>
                          생성 <b>{rc.created}</b> · 승인 <b>{rc.approved}</b> · 미검수 <b className={rc.pending > 0 ? "text-amber-800" : ""}>{rc.pending}</b>
                          {rc.held > 0 && <> · 보류 {rc.held}</>}
                        </p>
                        {rc.pending + rc.held > 0 && (
                          <Link href={`/admin/documents/${d.id}/review`} className="mt-1 inline-block rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100">
                            검수하기
                          </Link>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-start gap-1.5">
                      <a
                        href={`/admin/documents/${d.id}/download`}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        다운로드
                      </a>
                      {d.status !== "archived" && <ReextractButton docId={d.id} returnTo={returnTo} />}
                      {d.status !== "archived" && <ReviseButton docId={d.id} fileName={d.file_name} version={d.version} />}
                      <DeleteButton docId={d.id} fileName={d.file_name} linkedFaqs={linkedFaqs.get(d.id) ?? 0} returnTo={returnTo} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination basePath="/admin/documents" params={filterParams} page={page} total={total} />
    </>
  );
}
