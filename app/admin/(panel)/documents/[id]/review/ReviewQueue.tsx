"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { btnGhost, btnPrimary } from "@/components/admin/ui";
import type { Segment } from "@/lib/docs/highlight";
import { reviewApproveAction, reviewDeleteAction, reviewHoldAction } from "./actions";

export interface QueueItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  categoryLabel: string;
  /** 인증 종류: 문서의 값을 이어받지만 카드에서 건별로 바꿀 수 있다 */
  certType: string;
  status: "draft" | "approved";
  needsInput: boolean;
  hold: boolean;
  page: number | null;
  note: string | null;
  /** 근거 원문 (evidence 강조) */
  sources: { page: number | null; segments: Segment[] }[];
}

export interface RejectedView {
  page: number | null;
  content: string;
  reason: string;
  stageLabel: string;
  /** [직접 작성] 으로 이동할 등록 화면 주소 (질문·원문이 채워진다) */
  writeHref: string;
  /** 중복으로 탈락했을 때 겹치는 기존 FAQ 화면 */
  faqHref?: string;
}

export interface QueueDoc {
  id: string;
  fileName: string;
  certLabel: string;
  version: number;
}

type Tab = "pending" | "held" | "approved" | "rejected";

const CONFIRM_TAIL = "승인하면 즉시 챗봇이 이 내용으로 고객에게 답변합니다.\n\n내용을 확인하셨나요?";

export interface Option {
  value: string;
  label: string;
}

type Edit = { question: string; answer: string; cert_type: string; category: string };

export function ReviewQueue({
  doc,
  items: initial,
  rejected,
  jobMissing,
  certOptions,
  categoryOptions,
}: {
  doc: QueueDoc;
  items: QueueItem[];
  rejected: RejectedView[];
  jobMissing: boolean;
  certOptions: Option[];
  categoryOptions: Option[];
}) {
  const [items, setItems] = useState<QueueItem[]>(initial);
  const [edits, setEdits] = useState<Record<string, Edit>>(() => Object.fromEntries(initial.map((i) => [i.id, { question: i.question, answer: i.answer, cert_type: i.certType, category: i.category }])));
  const [tab, setTab] = useState<Tab>("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});

  const original = useMemo(() => Object.fromEntries(initial.map((i) => [i.id, { question: i.question, answer: i.answer }])), [initial]);
  const pending = items.filter((i) => i.status === "draft" && !i.hold);
  const held = items.filter((i) => i.status === "draft" && i.hold);
  const approved = items.filter((i) => i.status === "approved");
  const visible = useMemo(
    () => items.filter((i) => (tab === "pending" ? i.status === "draft" && !i.hold : tab === "held" ? i.status === "draft" && i.hold : tab === "approved" ? i.status === "approved" : false)),
    [items, tab],
  );

  /** 승인 가능: 초안이고, 답변이 있고, '담당자 입력 필요' 항목은 담당자가 답변을 직접 채운 경우만 */
  const eligible = useCallback(
    (i: QueueItem) => {
      const e = edits[i.id];
      if (!e || i.status !== "draft" || !e.answer.trim() || !e.question.trim()) return false;
      if (i.needsInput && e.answer === original[i.id]?.answer) return false;
      return true;
    },
    [edits, original],
  );

  const setBusyFor = (ids: string[], on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function approve(ids: string[]) {
    const targets = items.filter((i) => ids.includes(i.id) && eligible(i));
    const skipped = ids.length - targets.length;
    if (targets.length === 0) {
      setNotice({ tone: "warn", text: "승인할 수 있는 항목이 없습니다. 답변이 비어 있거나 '담당자 입력 필요' 항목은 답변을 채워야 합니다." });
      return;
    }
    setBusyFor(targets.map((t) => t.id), true);
    setNotice(null);
    const r = await reviewApproveAction(doc.id, targets.map((t) => ({ id: t.id, ...edits[t.id] })));
    setBusyFor(targets.map((t) => t.id), false);
    const ok = new Set(r.results.filter((x) => x.ok).map((x) => x.id));
    setItems((prev) => prev.map((i) => (ok.has(i.id) ? { ...i, status: "approved", hold: false, needsInput: false, question: edits[i.id].question.trim(), answer: edits[i.id].answer.trim(), certType: edits[i.id].cert_type, category: edits[i.id].category } : i)));
    setSelected((prev) => new Set([...prev].filter((id) => !ok.has(id))));
    setErrors((prev) => {
      const next = { ...prev };
      for (const id of ok) delete next[id];
      for (const x of r.results) if (!x.ok && x.error) next[x.id] = x.error;
      return next;
    });
    const failed = r.results.length - r.approved;
    setNotice({
      tone: failed > 0 ? "warn" : "ok",
      text: `${r.approved}건을 승인했습니다. 챗봇이 바로 사용합니다.${failed > 0 ? ` ${failed}건은 승인하지 못했습니다(카드의 안내 확인).` : ""}${skipped > 0 ? ` ${skipped}건은 답변이 비어 있어 건너뛰었습니다.` : ""}`,
    });
  }

  async function toggleHold(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item || item.status !== "draft") return;
    setBusyFor([id], true);
    const r = await reviewHoldAction(doc.id, id, !item.hold, edits[id]);
    setBusyFor([id], false);
    if (r.ok) {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, hold: !item.hold, question: edits[id].question.trim(), answer: edits[id].answer.trim(), certType: edits[id].cert_type, category: edits[id].category } : i)));
      setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
      setErrors((prev) => ({ ...prev, [id]: "" }));
    } else setErrors((prev) => ({ ...prev, [id]: r.error ?? "처리하지 못했습니다." }));
  }

  async function remove(id: string) {
    if (!window.confirm("이 초안을 삭제할까요? 되돌릴 수 없습니다.")) return;
    setBusyFor([id], true);
    const r = await reviewDeleteAction(doc.id, id);
    setBusyFor([id], false);
    if (r.ok) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
    } else setErrors((prev) => ({ ...prev, [id]: r.error ?? "삭제하지 못했습니다." }));
  }

  function bulkApprove(ids: string[], label: string) {
    const n = items.filter((i) => ids.includes(i.id) && eligible(i)).length;
    if (n === 0) return setNotice({ tone: "warn", text: "승인할 수 있는 항목이 없습니다." });
    if (!window.confirm(`${label} ${n}건을 승인합니다.\n${CONFIRM_TAIL}`)) return;
    void approve(ids);
  }

  // 키보드: A 승인, S 보류, D 삭제, ↑↓ 이동 (입력창에 글을 쓰는 중에는 동작하지 않는다)
  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const idx = focusId ? visible.findIndex((i) => i.id === focusId) : -1;
      const next = visible[Math.min(visible.length - 1, Math.max(0, idx < 0 ? 0 : idx + delta))];
      setFocusId(next.id);
      cardRefs.current[next.id]?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [visible, focusId],
  );
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    if (tab === "rejected") return;
    const k = e.key.toLowerCase();
    if (k === "arrowdown") {
      e.preventDefault();
      move(1);
    } else if (k === "arrowup") {
      e.preventDefault();
      move(-1);
    } else if (focusId && !busy.has(focusId)) {
      if (k === "a") void approve([focusId]);
      else if (k === "s") void toggleHold(focusId);
      else if (k === "d") void remove(focusId);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const selectedDrafts = [...selected].filter((id) => items.some((i) => i.id === id && i.status === "draft"));
  const eligibleAll = items.filter((i) => !i.hold && eligible(i));
  const tabBtn = (key: Tab, label: string, n: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === key ? "bg-teal-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
    >
      {label} {n}
    </button>
  );

  return (
    <div className="pb-28">
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <p className="break-words text-base font-bold text-slate-900">{doc.fileName}</p>
        <p className="mt-1 text-sm text-slate-600">
          인증 종류 {doc.certLabel} · v{doc.version}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {[
            ["생성", items.length],
            ["탈락", rejected.length],
            ["남은 미검수", pending.length],
            ["승인", approved.length],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-slate-50 px-2 py-2">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="text-xl font-bold tabular-nums text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>
        {held.length > 0 && <p className="mt-2 text-xs text-slate-500">보류 {held.length}건은 미검수에 세지 않습니다.</p>}
        {jobMissing && <p className="mt-2 text-xs text-amber-800">일괄 초안 작업 기록이 없어 탈락 건수는 표시되지 않습니다.</p>}
      </div>

      {notice && (
        <p role="status" className={`mb-3 rounded-lg border px-3 py-2 text-sm ${notice.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
          {notice.text}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="검수 상태">
        {tabBtn("pending", "미검수", pending.length)}
        {tabBtn("held", "보류", held.length)}
        {tabBtn("approved", "승인됨", approved.length)}
        {tabBtn("rejected", "탈락", rejected.length)}
        <span className="ml-auto hidden text-xs text-slate-500 md:inline">단축키: ↑↓ 이동 · A 승인 · S 보류 · D 삭제 (입력창 밖에서)</span>
      </div>

      {tab === "rejected" ? (
        <ul className="space-y-3">
          {rejected.length === 0 && <li className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">탈락한 항목이 없습니다.</li>}
          {rejected.map((r, i) => (
            <li key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">{r.stageLabel}</span>
                {r.page && <span className="text-slate-500">p.{r.page}</span>}
              </p>
              <p className="mt-2 break-words text-sm font-medium text-slate-900">{r.content}</p>
              <p className="mt-1 text-xs text-slate-600">
                사유: {r.reason}
                {r.faqHref && (
                  <Link href={r.faqHref} target="_blank" className="ml-1 font-medium text-teal-800 underline">
                    기존 FAQ 보기
                  </Link>
                )}
              </p>
              <Link href={r.writeHref} className={`${btnGhost} mt-2 inline-block !px-3 !py-1.5`}>
                직접 작성
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
          {visible.length === 0 && (
            <li className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              {tab === "pending" ? "검수할 초안이 없습니다." : tab === "held" ? "보류한 초안이 없습니다." : "승인한 항목이 없습니다."}
            </li>
          )}
          {visible.map((i) => {
            const e = edits[i.id] ?? { question: i.question, answer: i.answer, cert_type: i.certType, category: i.category };
            // 현재 인증 종류가 비활성이어도 선택지에 남겨 값이 사라지지 않게 한다
            const certChoices = certOptions.some((o) => o.value === e.cert_type) ? certOptions : [...certOptions, { value: e.cert_type, label: e.cert_type }];
            const isBusy = busy.has(i.id);
            const canApprove = i.status === "draft" && eligible(i);
            const err = errors[i.id];
            return (
              <li
                key={i.id}
                ref={(el) => {
                  cardRefs.current[i.id] = el;
                }}
                onClick={() => setFocusId(i.id)}
                className={`rounded-xl border bg-white p-4 transition-opacity ${focusId === i.id ? "border-teal-600 ring-2 ring-teal-200" : "border-slate-200"} ${i.hold ? "opacity-60" : ""} ${i.status === "approved" ? "bg-emerald-50/40" : ""}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  {i.status === "draft" && (
                    <input
                      type="checkbox"
                      checked={selected.has(i.id)}
                      onChange={(ev) => setSelected((prev) => (ev.target.checked ? new Set(prev).add(i.id) : new Set([...prev].filter((x) => x !== i.id))))}
                      aria-label="일괄 승인 대상으로 선택"
                      className="h-4 w-4"
                    />
                  )}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{i.categoryLabel}</span>
                  {i.needsInput && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">담당자 입력 필요</span>}
                  {i.hold && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">보류</span>}
                  {i.status === "approved" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">승인됨</span>}
                  {i.page && <span className="text-slate-500">출처 p.{i.page}</span>}
                </div>

                <label className="block text-xs font-medium text-slate-600">
                  질문
                  <input
                    value={e.question}
                    disabled={i.status === "approved" || isBusy}
                    onChange={(ev) => setEdits((prev) => ({ ...prev, [i.id]: { ...e, question: ev.target.value } }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 disabled:bg-slate-50"
                  />
                </label>
                <label className="mt-2 block text-xs font-medium text-slate-600">
                  답변{i.needsInput && !e.answer.trim() ? " (원문에 값이 없어 비어 있습니다. 담당자가 확인해 직접 입력하세요)" : ""}
                  <textarea
                    value={e.answer}
                    rows={Math.min(10, Math.max(3, e.answer.split("\n").length + 1))}
                    disabled={i.status === "approved" || isBusy}
                    onChange={(ev) => setEdits((prev) => ({ ...prev, [i.id]: { ...e, answer: ev.target.value } }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-900 disabled:bg-slate-50"
                  />
                </label>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-slate-600">
                    인증 종류
                    <select
                      value={e.cert_type}
                      disabled={i.status === "approved" || isBusy}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [i.id]: { ...e, cert_type: ev.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50"
                    >
                      {certChoices.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    카테고리
                    <select
                      value={e.category}
                      disabled={i.status === "approved" || isBusy}
                      onChange={(ev) => setEdits((prev) => ({ ...prev, [i.id]: { ...e, category: ev.target.value } }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-50"
                    >
                      {categoryOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {i.sources.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-teal-800 underline"
                      onClick={() => setOpen((prev) => (prev.has(i.id) ? new Set([...prev].filter((x) => x !== i.id)) : new Set(prev).add(i.id)))}
                    >
                      {open.has(i.id) ? "원문 닫기" : "원문 보기"}
                    </button>
                    {open.has(i.id) && (
                      <div className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">
                        {i.sources.map((s, k) => (
                          <p key={k} className="whitespace-pre-wrap break-words">
                            {s.page && <b className="mr-1 text-slate-500">p.{s.page}</b>}
                            {s.segments.map((seg, m) => (seg.mark ? <mark key={m} className="rounded bg-yellow-200 px-0.5 text-slate-900">{seg.text}</mark> : <span key={m}>{seg.text}</span>))}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {i.note && <p className="mt-2 text-xs text-amber-900">메모: {i.note}</p>}
                {err && (
                  <p role="alert" className="mt-2 text-xs text-red-700">
                    {err}
                  </p>
                )}

                {i.status === "draft" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={`${btnPrimary} !px-3 !py-1.5`} disabled={!canApprove || isBusy} title={canApprove ? "승인 (A)" : "답변이 비어 있거나 담당자 입력이 필요한 항목입니다"} onClick={() => approve([i.id])}>
                      {isBusy ? "처리 중…" : "승인"}
                    </button>
                    <button type="button" className={`${btnGhost} !px-3 !py-1.5`} disabled={isBusy} onClick={() => toggleHold(i.id)} title="보류 (S)">
                      {i.hold ? "보류 해제" : "보류"}
                    </button>
                    <button type="button" className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={isBusy} onClick={() => remove(i.id)} title="삭제 (D)">
                      삭제
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-sm text-slate-600">
            선택 <b className="tabular-nums">{selectedDrafts.length}</b>건
          </span>
          <button type="button" className={btnPrimary} disabled={selectedDrafts.length === 0 || busy.size > 0} onClick={() => bulkApprove(selectedDrafts, "선택한")}>
            일괄 승인
          </button>
          <button type="button" className={btnGhost} disabled={eligibleAll.length === 0 || busy.size > 0} onClick={() => bulkApprove(eligibleAll.map((i) => i.id), "승인 가능한 전체")}>
            전체 승인 ({eligibleAll.length})
          </button>
          <p className="basis-full text-xs text-slate-500 sm:basis-auto">승인 전에 확인 창이 한 번 더 뜹니다. 보류·답변이 빈 항목·입력 필요 항목은 전체 승인에서 제외됩니다.</p>
        </div>
      </div>
    </div>
  );
}

