"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary } from "@/components/admin/ui";
import { MSG_LIMIT_REACHED } from "@/lib/ingest/config";

export interface JobSummary {
  id: string;
  status: "running" | "done" | "failed" | "canceled";
  total_chunks: number;
  done_chunks: number;
  created_count: number;
  replaced_count: number;
  protected_count: number;
  rejected_count: number;
  error: string | null;
  /** 파일당 상한에 도달해 중단됨 */
  limit_reached?: boolean;
  /** '처리 실패'로 탈락한 항목 수 */
  error_count?: number;
}

interface RejectedItem {
  page: number | null;
  content: string;
  reason: string;
  stage: string;
  faq_id?: string;
}

const STAGE_LABELS: Record<string, string> = {
  evidence: "근거 불일치",
  numbers: "숫자 불일치",
  consulting: "컨설팅성",
  other_authority: "타 기관 안내",
  duplicate: "중복",
  limit: "상한 도달",
  format: "형식 문제",
  error: "처리 실패",
};

const small = "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_STEP_CALLS = 400; // 안전장치: 문서당 최대 호출 수

async function call(docId: string, body: Record<string, unknown>): Promise<{ ok: true; data: { job: JobSummary; busy?: boolean } } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/admin/documents/${docId}/generate-faq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "요청에 실패했습니다." };
    return { ok: true, data };
  } catch (err) {
    console.error("[doc-faq] 요청 실패:", err);
    return { ok: false, error: "네트워크 오류로 요청에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/** 작업을 시작(또는 이어서)하고 끝날 때까지 청크 묶음을 반복 처리한다. */
export async function runDocFaq(docId: string, resume: JobSummary | null, onProgress: (job: JobSummary) => void): Promise<{ ok: true; job: JobSummary } | { ok: false; error: string }> {
  let job: JobSummary;
  if (resume && resume.status === "running") {
    job = resume;
  } else {
    const started = await call(docId, { action: "start" });
    if (!started.ok) return started;
    job = started.data.job;
  }
  onProgress(job);
  for (let i = 0; i < MAX_STEP_CALLS && job.status === "running"; i++) {
    const r = await call(docId, { action: "step", jobId: job.id });
    if (!r.ok) return r;
    job = r.data.job;
    onProgress(job);
    if (r.data.busy) await sleep(1500);
  }
  if (job.status === "failed") return { ok: false, error: job.error ?? "작업이 실패했습니다." };
  return { ok: true, job };
}

function Summary({ job }: { job: JobSummary }) {
  return (
    <span>
      초안 <b>{job.created_count}</b>건 생성 · 탈락 <b>{job.rejected_count}</b>건
      {job.replaced_count > 0 && <> · 이전 초안 {job.replaced_count}건 교체</>}
      {job.protected_count > 0 && <> · 수정한 초안 {job.protected_count}건 유지</>}
      {job.limit_reached && <span className="mt-0.5 block font-semibold text-amber-800">{MSG_LIMIT_REACHED}</span>}
    </span>
  );
}

/** 탈락 목록 (사유·원문 일부). 담당자가 필요하면 직접 작성할 수 있게 보여준다. */
function RejectedList({ docId }: { docId: string }) {
  const [state, setState] = useState<{ loading: boolean; items: RejectedItem[]; error?: string } | null>(null);

  async function toggle() {
    if (state) return setState(null);
    setState({ loading: true, items: [] });
    try {
      const res = await fetch(`/api/admin/documents/${docId}/generate-faq`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "불러오지 못했습니다.");
      setState({ loading: false, items: (data.job?.rejected ?? []) as RejectedItem[] });
    } catch (err) {
      setState({ loading: false, items: [], error: err instanceof Error ? err.message : "불러오지 못했습니다." });
    }
  }

  return (
    <div className="mt-1">
      <button type="button" onClick={toggle} className="text-xs font-medium text-teal-800 underline">
        {state ? "탈락 목록 닫기" : "탈락 목록 보기"}
      </button>
      {state && (
        <div className="mt-1 max-h-72 w-[22rem] max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
          {state.loading && <p className="text-slate-500">불러오는 중…</p>}
          {state.error && <p className="text-red-700">{state.error}</p>}
          {!state.loading && !state.error && state.items.length === 0 && <p className="text-slate-500">탈락한 항목이 없습니다.</p>}
          <ul className="space-y-2">
            {state.items.map((r, i) => (
              <li key={i} className="rounded border border-slate-200 bg-white p-1.5">
                <p className="font-semibold text-slate-800">
                  <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900">{STAGE_LABELS[r.stage] ?? r.stage}</span>
                  {r.page ? `p.${r.page}` : ""}
                </p>
                <p className="mt-0.5 break-words text-slate-700">{r.content}</p>
                <p className="mt-0.5 text-slate-500">
                  사유: {r.reason}
                  {r.faq_id && (
                    <a href={`/admin/faq/${r.faq_id}`} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-teal-800 underline">
                      기존 FAQ 보기
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 문서 목록 행의 [FAQ 초안 만들기] / [다시 만들기] */
export function DocFaqCell({
  docId,
  fileName,
  eligible,
  reason,
  latest,
  autoDrafts,
  completed = false,
}: {
  docId: string;
  fileName: string;
  eligible: boolean;
  reason?: string;
  latest: JobSummary | null;
  autoDrafts: number;
  /** FAQ 초안을 만들어 모두 승인한 문서: 버튼을 숨기고 요약만 보여준다 */
  completed?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(latest);
  const [error, setError] = useState("");

  const unfinished = job?.status === "running" && !busy;
  const done = job?.status === "done";
  const again = done || autoDrafts > 0;

  async function run(resume: boolean) {
    if (!resume && again && !window.confirm(`'${fileName}' 에서 만든 이전 자동 초안을 새 초안으로 교체합니다.\n수정해 둔 초안, 미답변에서 만든 초안, 승인된 FAQ는 그대로 유지됩니다. 계속할까요?`)) return;
    setBusy(true);
    setError("");
    const r = await runDocFaq(docId, resume ? job : null, setJob);
    setBusy(false);
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  if (!eligible) {
    return reason ? (
      <span title={reason} className="cursor-help text-xs text-slate-400">
        FAQ 초안 불가
      </span>
    ) : null;
  }

  if (completed) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">승인 완료</span>
        <span className="max-w-[16rem] text-xs text-slate-500">내용을 바꾸려면 <b>개정판 올리기</b> 또는 FAQ 수정을 이용하세요.</span>
        {job && job.status !== "canceled" && (
          <span className="max-w-[16rem] text-xs text-slate-600">
            <Summary job={job} />
          </span>
        )}
        {job && job.rejected_count > 0 && <RejectedList docId={docId} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {unfinished ? (
        <button type="button" className={`${small} border-amber-300 bg-amber-50`} onClick={() => run(true)}>
          이어서 진행 ({job!.done_chunks}/{job!.total_chunks})
        </button>
      ) : (
        <button type="button" className={small} disabled={busy} onClick={() => run(false)}>
          {busy ? `만드는 중… 청크 ${job ? Math.min(job.done_chunks, job.total_chunks) : 0}/${job?.total_chunks ?? "?"}` : again ? "FAQ 초안 다시 만들기" : "FAQ 초안 만들기"}
        </button>
      )}
      {busy && job && (
        <span className="block h-1.5 w-40 overflow-hidden rounded bg-slate-200" aria-hidden>
          <span className="block h-full bg-teal-600 transition-all" style={{ width: `${Math.round((Math.min(job.done_chunks, job.total_chunks) / Math.max(1, job.total_chunks)) * 100)}%` }} />
        </span>
      )}
      {!busy && job && job.status !== "canceled" && (
        <span className="max-w-[16rem] text-xs text-slate-600">
          {job.status === "failed" ? <span className="text-red-700">실패: {job.error ?? "오류"}</span> : <Summary job={job} />}
        </span>
      )}
      {!busy && job && job.rejected_count > 0 && <RejectedList docId={docId} />}
      {error && (
        <span role="alert" className="max-w-[16rem] text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

/** 선택한 여러 문서를 차례로 실행 (체크박스는 name="gen" form="bulk-gen" 으로 연결된다) */
export function DocFaqBulk() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<{ id: string; name: string; text: string; tone: "info" | "ok" | "warn" }[]>([]);

  async function run() {
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="gen"][form="bulk-gen"]:checked'));
    if (boxes.length === 0) {
      setLines([{ id: "none", name: "", text: "FAQ 초안을 만들 문서를 먼저 선택해 주세요.", tone: "warn" }]);
      return;
    }
    const targets = boxes.map((b) => ({ id: b.value, name: b.dataset.name ?? b.value, again: b.dataset.again === "1" }));
    if (targets.some((t) => t.again) && !window.confirm("이미 초안을 만든 문서가 포함되어 있습니다. 이전 자동 초안은 교체됩니다.\n(수정한 초안, 미답변에서 만든 초안, 승인된 FAQ는 유지) 계속할까요?")) return;
    setBusy(true);
    setLines(targets.map((t) => ({ id: t.id, name: t.name, text: "대기 중", tone: "info" as const })));
    const set = (id: string, text: string, tone: "info" | "ok" | "warn") => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text, tone } : l)));
    for (const t of targets) {
      set(t.id, "시작하는 중…", "info");
      const r = await runDocFaq(t.id, null, (job) => set(t.id, `청크 ${Math.min(job.done_chunks, job.total_chunks)}/${job.total_chunks} · 초안 ${job.created_count}건`, "info"));
      if (r.ok) set(t.id, `완료 — 초안 ${r.job.created_count}건 생성, 탈락 ${r.job.rejected_count}건`, "ok");
      else set(t.id, `실패 — ${r.error}`, "warn");
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <form id="bulk-gen" onSubmit={(e) => e.preventDefault()} className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={busy} onClick={run}>
          {busy ? "만드는 중…" : "선택한 문서 FAQ 초안 만들기"}
        </button>
        <p className="text-xs text-slate-500">
          문서 한 건에서 FAQ 초안을 여러 건 만듭니다. 초안은 항상 &lsquo;초안&rsquo; 상태이며 승인은 사람이 합니다. 이 화면을 닫으면 작업이 멈추고, 같은 문서에서 &lsquo;이어서 진행&rsquo;할 수 있습니다.
        </p>
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs" aria-live="polite">
          {lines.map((l) => (
            <li key={l.id} className={l.tone === "warn" ? "text-red-700" : l.tone === "ok" ? "text-emerald-800" : "text-slate-600"}>
              {l.name && <b className="mr-1">{l.name}</b>}
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
