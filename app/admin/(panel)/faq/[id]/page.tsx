import Link from "next/link";
import { notFound } from "next/navigation";
import { NeedsInputBadge, PageTitle, StatusBadge, btnPrimary } from "@/components/admin/ui";
import { CERT_NAMES, listCertNames } from "@/lib/cert-names";
import { formatKst } from "@/lib/admin/labels";
import { getFaq } from "@/lib/db/admin-faq";
import { getSourceView, type SourceView } from "@/lib/db/admin-faq-review";
import { getUnansweredAdmin } from "@/lib/db/admin-unanswered";
import { approveFaqAction, confirmReviewAction } from "../../actions";
import { FaqEditor, type FaqFormValues } from "./FaqForm";
import type { Faq } from "@/lib/db/types";

export const dynamic = "force-dynamic";
// [새 문서로 초안 다시 만들기]는 문서를 읽고 Claude 를 호출한다
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function SourceCard({ faq, view }: { faq: Faq; view: SourceView }) {
  const docName = view.doc?.file_name ?? (faq.review_reason === "deleted" ? "삭제된 문서" : "(출처 문서 없음)");
  return (
    <aside aria-label="출처 원문" className="rounded-xl border border-slate-200 bg-white lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
      <div className="border-b border-slate-100 p-4">
        <p className="text-xs font-semibold text-slate-500">출처 문서</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-slate-900">{docName}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {faq.source_page !== null && <span>페이지 {faq.source_page}</span>}
          {view.doc && <span>v{view.doc.version}</span>}
          {view.doc?.status === "archived" && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">이전 버전</span>}
          {view.doc && (
            <a href={`/admin/documents/${view.doc.id}/download`} className="font-medium text-teal-800 underline">
              파일 내려받기
            </a>
          )}
        </p>
        {view.latest && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            새 버전이 있습니다: <b>{view.latest.file_name}</b> (v{view.latest.version})
          </p>
        )}
        {!view.doc && faq.review_reason === "deleted" && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-900">이 FAQ의 출처 문서가 삭제되었습니다. 원문을 다시 볼 수 없습니다.</p>}
      </div>

      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-50">
          <span>원문 보기</span>
          <span className="text-xs font-normal text-slate-500 group-open:hidden">펼치기</span>
          <span className="hidden text-xs font-normal text-slate-500 group-open:inline">접기</span>
        </summary>
        <div className="space-y-3 px-4 pb-4">
          {view.chunks.length === 0 && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              {view.doc ? "원문에서 근거 문장이 들어 있는 부분을 찾지 못했습니다." : "원문을 볼 수 없습니다."}
              {(faq.source_evidence ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {faq.source_evidence.map((e, i) => (
                    <li key={i} className="rounded bg-yellow-100 px-2 py-1 text-xs text-slate-800">
                      <b>저장된 근거</b> {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {view.chunks.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                {c.page_no !== null ? `p.${c.page_no}` : "본문"}
                {c.section_title ? ` · ${c.section_title}` : ""}
              </p>
              <p className="whitespace-pre-wrap break-words p-3 text-sm leading-relaxed text-slate-800">
                {c.segments.map((s, i) =>
                  s.mark ? (
                    <mark key={i} className="rounded bg-yellow-200 px-0.5 text-slate-900">
                      {s.text}
                    </mark>
                  ) : (
                    <span key={i}>{s.text}</span>
                  ),
                )}
              </p>
            </div>
          ))}
          {view.missingEvidence.length > 0 && view.chunks.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">원문에서 찾지 못한 근거 문장 {view.missingEvidence.length}개 (문서가 다시 추출되어 달라졌을 수 있습니다)</p>
          )}
          <p className="text-xs text-slate-500">
            <mark className="rounded bg-yellow-200 px-1">노란 표시</mark>는 이 답변의 근거로 쓰인 원문 문장입니다.
          </p>
        </div>
      </details>
    </aside>
  );
}

export default async function FaqEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ question?: string; answer?: string; cert?: string; unanswered?: string; back?: string; err?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === "new";
  if (!isNew && !UUID.test(id)) notFound();

  const faq = isNew ? null : await getFaq(id);
  if (!isNew && !faq) notFound();

  // 미답변 질문에서 넘어온 경우: 질문을 채운 채로 열고, 저장하면 그 질문을 처리 완료로 표시한다.
  const unanswered = isNew && sp.unanswered && UUID.test(sp.unanswered) ? await getUnansweredAdmin(sp.unanswered) : null;

  const values: FaqFormValues = faq
    ? {
        id: faq.id,
        question: faq.question,
        variants: faq.variants.join("\n"),
        answer: faq.answer,
        cert_type: faq.cert_type,
        category: faq.category,
        source_url: faq.source_url ?? "",
        status: faq.status,
        needs_input: faq.needs_input,
      }
    : { id: "new", question: unanswered?.question ?? sp.question ?? "", variants: "", answer: sp.answer?.slice(0, 3000) ?? "", cert_type: sp.cert && /^[a-z0-9-]+$/.test(sp.cert) ? sp.cert : "", category: "scope", source_url: "", status: "draft", needs_input: false };

  const certOptions = [{ slug: "common", name: "공통 (모든 인증)" }, ...listCertNames()];
  if (values.cert_type && !certOptions.some((o) => o.slug === values.cert_type) && !(values.cert_type in CERT_NAMES)) {
    certOptions.push({ slug: values.cert_type, name: `${values.cert_type} (미등록)` });
  }

  const returnTo = unanswered ? "/admin/unanswered" : sp.back?.startsWith("/admin") && !sp.back.startsWith("//") ? sp.back : "/admin/faq";
  const view = faq ? await getSourceView(faq) : null;
  const hasSource = !!faq && (!!faq.source_doc_id || (faq.source_evidence?.length ?? 0) > 0 || faq.review_reason === "deleted");
  const needsReview = !!faq?.needs_review;
  const isAutoDraft = !!faq?.source_unanswered_id;
  // 문서가 있는 재검토, 또는 문서 기반 초안이면 새 문서로 초안을 다시 만들 수 있다
  const canRegenerate = !!faq && (needsReview || (isAutoDraft && faq.status === "draft"));
  const approvable = !!faq && faq.status !== "approved" && !faq.needs_input && faq.answer.trim() !== "";

  return (
    <>
      <PageTitle title={isNew ? "FAQ 등록" : "FAQ 수정"}>
        <Link href={returnTo} className="text-sm text-slate-600 hover:underline">
          ← 목록으로
        </Link>
      </PageTitle>

      {sp.err && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.err}
        </p>
      )}

      {needsReview && faq && (
        <div role="note" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-bold">
            {faq.review_reason === "deleted" ? "출처 문서가 삭제되어 재검토가 필요합니다" : "출처 문서가 개정되어 재검토가 필요합니다"}
          </p>
          {faq.review_note && <p className="mt-1 text-amber-900">{faq.review_note}</p>}
          <p className="mt-1 text-amber-900">
            이 FAQ는 <b>승인 상태 그대로 계속 서비스</b>되고 있습니다. 답변이 새 문서와 맞는지 확인하고, 그대로면 &lsquo;변경 없음&rsquo;, 달라졌으면 아래에서 새 초안을 만들어 비교·수정하세요.
          </p>
          <form action={confirmReviewAction} className="mt-3">
            <input type="hidden" name="id" value={faq.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button type="submit" className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100">
              변경 없음 — 재검토 완료
            </button>
          </form>
        </div>
      )}

      {faq && isAutoDraft && (
        <div role="note" className={`mb-4 rounded-xl border px-4 py-3 text-sm ${faq.needs_input ? "border-amber-300 bg-amber-50 text-amber-950" : "border-sky-200 bg-sky-50 text-sky-950"}`}>
          <p className="font-bold">{faq.needs_input ? "문서에서 근거를 찾지 못한 초안입니다 (보완 필요)" : "문서에서 자동으로 만든 초안입니다"}</p>
          <p className="mt-1">{faq.draft_note || "오른쪽 원문과 비교해 확인하세요."}</p>
          <p className="mt-1 text-xs opacity-80">초안은 승인하기 전에는 챗봇 답변에 쓰이지 않습니다.</p>
        </div>
      )}

      {faq && !isAutoDraft && faq.needs_input && (
        <div role="note" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>보완이 필요한 항목입니다.</b> 아직 확정된 답변이 없어서 챗봇이 이 항목으로 답하지 않고 담당자 안내로 처리합니다. 답변을 입력하고 &lsquo;담당자 입력 필요&rsquo;를 해제한 뒤 승인하면 챗봇에 바로 반영됩니다.
        </div>
      )}
      {unanswered && (
        <div role="note" className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          고객이 물었지만 답하지 못한 질문입니다. 답변을 작성해 저장하면 이 질문은 &lsquo;처리 완료&rsquo;로 표시됩니다.
        </div>
      )}

      {faq && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <StatusBadge status={faq.status} />
          {faq.needs_input && <NeedsInputBadge />}
          {needsReview && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">재검토 필요</span>}
          <span>등록 {formatKst(faq.created_at)}</span>
          <span>· 수정 {formatKst(faq.updated_at)}</span>
          {faq.status === "approved" && <span>· 승인 {faq.approved_by ? `${faq.approved_by}${faq.approved_at ? ` (${formatKst(faq.approved_at)})` : ""}` : "기록 없음"}</span>}
          {approvable && (
            <form action={approveFaqAction} className="ml-auto">
              <input type="hidden" name="id" value={faq.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className={`${btnPrimary} !px-4 !py-2`}>
                승인
              </button>
            </form>
          )}
        </div>
      )}

      <div className={hasSource ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}>
        <FaqEditor values={values} certOptions={certOptions} returnTo={returnTo} unansweredId={unanswered?.id} needsReview={needsReview} canRegenerate={canRegenerate} canDelete={!isNew && faq?.status === "draft"} />
        {hasSource && faq && view && <SourceCard faq={faq} view={view} />}
      </div>
    </>
  );
}
