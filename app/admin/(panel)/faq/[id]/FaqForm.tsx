"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { btnGhost, btnPrimary, inputCls } from "@/components/admin/ui";
import { CATEGORY_LABELS } from "@/lib/admin/labels";
import { deleteFaqAction, saveFaqAction, type SaveState } from "../../actions";
import { checkSimilarFaqAction, type SimilarView } from "../similar-actions";
import { regenerateDraftAction, type RegenerateState } from "./review-actions";

export interface FaqFormValues {
  id: string; // "new" 이면 등록
  question: string;
  variants: string;
  answer: string;
  cert_type: string;
  category: string;
  source_url: string;
  status: string;
  needs_input: boolean;
}

interface Applied {
  docId: string;
  page: number | null;
  evidence: string[];
  nonce: number;
}

/**
 * FAQ 편집기: 답변 입력, (재검토 중이면) 새 문서로 만든 초안과 나란히 비교, 저장 / 수정 후 승인.
 * 새 초안은 저장 전까지 아무것도 바꾸지 않는다 — 입력란에 채운 뒤 사람이 확인하고 저장해야 반영된다.
 */
export function FaqEditor({
  values,
  certOptions,
  returnTo,
  unansweredId,
  needsReview,
  canRegenerate,
  canDelete,
}: {
  values: FaqFormValues;
  certOptions: { slug: string; name: string }[];
  returnTo: string;
  unansweredId?: string;
  needsReview: boolean;
  canRegenerate: boolean;
  /** 저장된 상태가 초안일 때만 삭제 버튼을 보여준다 (승인된 FAQ 는 삭제할 수 없다) */
  canDelete?: boolean;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveFaqAction, {});
  const [regen, regenAction, regenPending] = useActionState<RegenerateState, FormData>(regenerateDraftAction, { status: "idle" });
  const [answer, setAnswer] = useState(values.answer);
  const [applied, setApplied] = useState<Applied | null>(null);
  const isNew = values.id === "new";

  // 유사 FAQ 경고: 질문·인증 종류를 입력하면 같은 인증 종류의 approved + draft FAQ 중 비슷한 질문을 찾아 링크로 보여준다.
  // 경고만 하고 저장은 막지 않는다.
  const formRef = useRef<HTMLFormElement>(null);
  const [similar, setSimilar] = useState<SimilarView[]>([]);
  const lastChecked = useRef("");
  const checkSimilar = useCallback(async () => {
    const f = formRef.current;
    if (!f) return;
    const question = (f.elements.namedItem("question") as HTMLInputElement | null)?.value.trim() ?? "";
    const cert = (f.elements.namedItem("cert_type") as HTMLSelectElement | null)?.value ?? "";
    const key = `${cert}|${question}`;
    if (!question || !cert || key === lastChecked.current) return;
    lastChecked.current = key;
    setSimilar(await checkSimilarFaqAction(question, cert, isNew ? undefined : values.id));
  }, [isNew, values.id]);
  useEffect(() => {
    if (isNew && values.question && values.cert_type) void checkSimilar();
  }, [isNew, values.question, values.cert_type, checkSimilar]);

  function fillFrom(r: Extract<RegenerateState, { status: "drafted" }>) {
    setAnswer(r.answer);
    setApplied({ docId: r.docId, page: r.page, evidence: r.evidence, nonce: Date.now() });
  }

  return (
    <div className="space-y-4">
      {canRegenerate && (
        <section aria-label="새 문서로 초안 다시 만들기" className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <form action={regenAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={values.id} />
            <button type="submit" disabled={regenPending} className={btnPrimary}>
              {regenPending ? "문서를 읽는 중…" : "새 문서로 초안 다시 만들기"}
            </button>
            <span className="text-xs text-sky-900">이 질문으로 새 문서에서 근거를 다시 찾아, 아래에서 기존 답변과 나란히 비교합니다. 기존 답변은 바꾸지 않습니다.</span>
          </form>

          {regen.status !== "idle" && (
            <div className="mt-4 space-y-3">
              {regen.scope && <p className="text-xs text-slate-600">검색 범위: {regen.scope}</p>}
              {regen.status === "drafted" ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="mb-1 text-xs font-semibold text-slate-500">기존 답변 (지금 서비스 중)</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{values.answer || "(비어 있음)"}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-300 bg-white p-3">
                      <p className="mb-1 text-xs font-semibold text-emerald-800">새 초안 (신뢰도 {regen.confidence})</p>
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{regen.answer}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        출처: {regen.sources.map((s) => `${s.file_name}${s.page_no ? ` p.${s.page_no}` : ""}`).join(", ")}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {regen.evidence.map((e, i) => (
                          <li key={i} className="rounded bg-yellow-100 px-2 py-1 text-xs text-slate-800">
                            <b>근거</b> {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <button type="button" onClick={() => fillFrom(regen)} className={btnGhost}>
                    새 초안 내용을 아래 답변 입력란에 채우기
                  </button>
                  {applied && <p className="text-xs text-emerald-800">채웠습니다. 내용을 확인하고 필요하면 고친 뒤 아래 [저장] 또는 [수정 후 승인]을 누르세요. 저장하기 전에는 아무것도 바뀌지 않습니다.</p>}
                </>
              ) : (
                <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {regen.status === "blocked" ? "초안을 만들지 않았습니다: " : regen.status === "rejected" ? "근거 검증에서 초안을 버렸습니다: " : "새 초안을 만들 수 없습니다: "}
                  {regen.reason}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <form ref={formRef} action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <input type="hidden" name="id" value={values.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {unansweredId && <input type="hidden" name="unanswered" value={unansweredId} />}
        {applied && (
          <>
            <input type="hidden" name="apply_doc_id" value={applied.docId} />
            <input type="hidden" name="apply_page" value={applied.page ?? ""} />
            <input type="hidden" name="apply_evidence" value={JSON.stringify(applied.evidence)} />
          </>
        )}

        {state.error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        )}

        <Field label="질문" required>
          <input name="question" defaultValue={values.question} required maxLength={300} className={inputCls} onBlur={checkSimilar} />
        </Field>

        {similar.length > 0 && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p className="font-semibold">비슷한 FAQ가 있습니다</p>
            <p className="text-xs text-amber-900">같은 인증 종류에 의미가 같은 질문이 있을 수 있습니다. 확인해 보세요. (저장은 그대로 할 수 있습니다)</p>
            <ul className="mt-1 space-y-1">
              {similar.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "approved" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{s.status === "approved" ? "승인" : "초안"}</span>
                  <a href={`/admin/faq/${s.id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-900 underline">
                    {s.question}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="다른 표현" hint="같은 질문을 고객이 다르게 물을 때의 표현입니다. 한 줄에 하나씩 적어 주세요. (챗봇이 관련 FAQ를 찾는 데 쓰입니다)">
          <textarea name="variants" defaultValue={values.variants} rows={3} className={inputCls} />
        </Field>

        <Field label="답변" hint="챗봇이 그대로 근거로 삼는 내용입니다. 확정된 내용만 적어 주세요. 비용·기간은 담당자가 확정한 값만 입력합니다.">
          <textarea name="answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={7} maxLength={3000} className={inputCls} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="인증 종류" required>
            <select name="cert_type" defaultValue={values.cert_type} required className={inputCls} onChange={checkSimilar}>
              <option value="" disabled>
                선택해 주세요
              </option>
              {certOptions.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="카테고리" required>
            <select name="category" defaultValue={values.category} required className={inputCls}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="출처 URL" hint="답변 아래에 고객에게 보여줄 근거 링크입니다.">
          <input name="source_url" type="url" defaultValue={values.source_url} placeholder="https://igsc.kr/…" className={inputCls} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="상태" hint="'승인'된 FAQ만 챗봇 답변에 쓰입니다.">
            <select name="status" defaultValue={values.status} className={inputCls}>
              <option value="draft">초안</option>
              <option value="approved">승인</option>
            </select>
          </Field>
          <div className="flex items-start gap-2 pt-6">
            <input id="needs_input" name="needs_input" type="checkbox" defaultChecked={values.needs_input} className="mt-1 h-4 w-4" />
            <label htmlFor="needs_input" className="text-sm text-slate-800">
              담당자 입력 필요
              <span className="block text-xs text-slate-500">답변을 채운 뒤에는 체크를 해제해야 승인할 수 있습니다.</span>
            </label>
          </div>
        </div>

        {needsReview && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <input id="clear_review" name="clear_review" type="checkbox" defaultChecked className="mt-1 h-4 w-4" />
            <label htmlFor="clear_review" className="text-sm text-amber-950">
              재검토를 마쳤습니다 (저장하면 &lsquo;재검토 필요&rsquo; 표시를 해제)
              <span className="block text-xs text-amber-800">답변은 계속 서비스 중이며, 저장하는 내용이 바로 반영됩니다.</span>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <button type="submit" disabled={pending} className={btnGhost}>
            {pending ? "저장 중…" : "저장"}
          </button>
          {!isNew && (
            <button type="submit" name="intent" value="approve" disabled={pending} className={btnPrimary}>
              수정 후 승인
            </button>
          )}
          <Link href={returnTo} className={btnGhost}>
            취소
          </Link>
          {canDelete && (
            // 별도 폼(아래)을 form 속성으로 가리킨다: 폼 안에 폼을 넣을 수 없다. 확인 창에서 취소하면 제출하지 않는다.
            <button
              type="submit"
              form="faq-delete-form"
              onClick={(e) => {
                if (!window.confirm("이 초안을 삭제할까요?\n삭제하면 되돌릴 수 없습니다. (승인된 FAQ는 삭제되지 않습니다)")) e.preventDefault();
              }}
              className="ml-auto rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              삭제
            </button>
          )}
        </div>
      </form>
      {canDelete && (
        <form id="faq-delete-form" action={deleteFaqAction}>
          <input type="hidden" name="id" value={values.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
        </form>
      )}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-800">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
