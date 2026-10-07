"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, inputCls } from "@/components/admin/ui";
import { runUploads, type UploadItem } from "@/components/admin/upload-pipeline";
import { sha256File } from "@/lib/admin/file-hash";
import { preflightUploadsAction } from "./actions";
import { ALLOWED_EXT_LABEL, MAX_FILES_PER_BATCH, checkFile, formatBytes } from "@/lib/admin/documents";

interface Option {
  value: string;
  label: string;
}

interface Staged {
  key: string;
  file: File;
  certType: string;
  category: string;
  docFormat: string;
  state: "ready" | "uploading" | "done" | "error";
  error?: string;
}

interface Notice {
  tone: "hwp" | "warn";
  text: string;
}

let seq = 0;

export function DocumentUploader({ certOptions, categoryOptions }: { certOptions: Option[]; categoryOptions: Option[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [defaults, setDefaults] = useState({ certType: "common", category: "other", docFormat: "narrative" });
  // 같은 이름의 문서가 있을 때 [개정판으로 올리기] [별도 문서로 올리기] [취소] 중 고르는 창
  const [conflict, setConflict] = useState<{ fileName: string; existing: { file_name: string; version: number }; resolve: (c: "revise" | "separate" | "cancel") => void } | null>(null);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");

  function addFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const nextNotices: Notice[] = [];
    const accepted: Staged[] = [];
    for (const file of files) {
      const check = checkFile(file.name, file.size);
      if (!check.ok) {
        nextNotices.push({ tone: check.code === "hwp" ? "hwp" : "warn", text: `${file.name.normalize("NFC")} — ${check.message}` });
        continue;
      }
      accepted.push({ key: `f${++seq}`, file, certType: defaults.certType, category: defaults.category, docFormat: defaults.docFormat, state: "ready" });
    }
    setSummary("");
    setNotices(nextNotices);
    setStaged((prev) => {
      const room = MAX_FILES_PER_BATCH - prev.length;
      if (accepted.length > room) {
        setNotices((n) => [...n, { tone: "warn", text: `한 번에 ${MAX_FILES_PER_BATCH}개까지 올릴 수 있어 일부 파일은 제외했습니다.` }]);
      }
      return [...prev, ...accepted.slice(0, Math.max(0, room))];
    });
  }

  const update = (key: string, patch: Partial<Staged>) => setStaged((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const askConflict = (fileName: string, existing: { file_name: string; version: number }) =>
    new Promise<"revise" | "separate" | "cancel">((resolve) => setConflict({ fileName, existing, resolve }));

  async function upload() {
    const targets = staged.filter((s) => s.state === "ready" || s.state === "error");
    if (targets.length === 0 || busy) return;
    setBusy(true);
    setSummary("");
    setNotices([]);

    // 1) 내용 해시 계산 + 사전 확인: 같은 내용의 파일은 차단하고, 이름만 같은 문서는 선택지를 띄운다
    const hashes: Record<string, string> = {};
    try {
      for (const t of targets) hashes[t.key] = await sha256File(t.file);
    } catch (err) {
      console.error("[documents] 파일 해시 계산 실패:", err);
      setNotices([{ tone: "warn", text: "파일을 읽지 못했습니다. 파일이 열려 있거나 바뀌었다면 닫고 다시 선택해 주세요." }]);
      setBusy(false);
      return;
    }
    let pre: Awaited<ReturnType<typeof preflightUploadsAction>> = [];
    try {
      pre = await preflightUploadsAction(targets.map((t) => ({ fileName: t.file.name, hash: hashes[t.key] })));
    } catch (err) {
      console.error("[documents] 사전 확인 실패:", err);
    }

    const proceed: { t: Staged; supersedesId?: string; allowSameName?: boolean }[] = [];
    const dropped = new Set<string>();
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const r = pre[i];
      if (!r || r.status === "ok") {
        proceed.push({ t });
      } else if (r.status === "duplicate") {
        update(t.key, { state: "error", error: r.message });
      } else {
        const choice = await askConflict(t.file.name.normalize("NFC"), r.existing);
        setConflict(null);
        if (choice === "revise") proceed.push({ t, supersedesId: r.existing.id });
        else if (choice === "separate") proceed.push({ t, allowSameName: true });
        else dropped.add(t.key);
      }
    }
    if (dropped.size) setStaged((prev) => prev.filter((s) => !dropped.has(s.key)));
    if (proceed.length === 0) {
      setBusy(false);
      return;
    }

    // 2) 업로드
    const items: UploadItem[] = proceed.map((p) => ({
      file: p.t.file,
      certType: p.t.certType,
      category: p.t.category,
      docFormat: p.t.docFormat,
      hash: hashes[p.t.key],
      supersedesId: p.supersedesId,
      allowSameName: p.allowSameName,
    }));
    const ok = await runUploads(items, (i, st) => update(proceed[i].t.key, { state: st.state, error: st.error }));
    setBusy(false);
    setSummary(ok === proceed.length ? `${ok}개 파일을 올렸습니다.` : `${proceed.length}개 중 ${ok}개를 올렸습니다. 실패한 파일은 아래에서 사유를 확인하세요.`);
    setStaged((prev) => prev.filter((s) => s.state !== "done"));
    router.refresh();
  }

  const pending = staged.filter((s) => s.state !== "done").length;

  return (
    <section aria-label="문서 업로드" className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-teal-700 bg-teal-50" : "border-slate-300 bg-slate-50"}`}
      >
        <p className="text-sm font-semibold text-slate-800">여기로 파일을 끌어다 놓거나</p>
        <button type="button" onClick={() => inputRef.current?.click()} className={`${btnPrimary} mt-3`} disabled={busy}>
          파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label="업로드할 파일 선택"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = ""; // 같은 파일을 다시 고를 수 있게
          }}
        />
        <p className="mt-3 text-xs text-slate-500">
          {ALLOWED_EXT_LABEL} · 파일당 20MB 이하 · 한 번에 최대 {MAX_FILES_PER_BATCH}개
          <br />
          HWP(한글) 파일은 PDF로 저장해서 올려 주세요.
        </p>
      </div>

      {notices.map((n, i) => (
        <p
          key={i}
          role="alert"
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${n.tone === "hwp" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {n.text}
        </p>
      ))}
      {summary && (
        <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {summary}
        </p>
      )}

      {staged.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="text-xs font-medium text-slate-600">
              새로 추가하는 파일의 기본 인증 종류
              <select value={defaults.certType} onChange={(e) => setDefaults((d) => ({ ...d, certType: e.target.value }))} className={`${inputCls} mt-1`}>
                {certOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              기본 분류
              <select value={defaults.category} onChange={(e) => setDefaults((d) => ({ ...d, category: e.target.value }))} className={`${inputCls} mt-1`}>
                {categoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              문서 형식
              <select value={defaults.docFormat} onChange={(e) => setDefaults((d) => ({ ...d, docFormat: e.target.value }))} className={`${inputCls} mt-1`}>
                <option value="narrative">설명 자료</option>
                <option value="qa_pairs">질문·답변이 정리된 자료</option>
              </select>
            </label>
            <button
              type="button"
              className="self-end rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              disabled={busy}
              onClick={() => setStaged((prev) => prev.map((s) => (s.state === "ready" ? { ...s, ...defaults } : s)))}
            >
              대기 중인 파일 모두에 적용
            </button>
          </div>

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {staged.map((s) => (
              <li key={s.key} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_170px_130px_150px_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900" title={s.file.name.normalize("NFC")}>
                    {s.file.name.normalize("NFC")}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatBytes(s.file.size)}
                    {s.state === "uploading" && <span className="ml-2 text-teal-800">올리는 중…</span>}
                    {s.state === "error" && <span className="ml-2 text-red-700">{s.error}</span>}
                  </p>
                </div>
                <select
                  aria-label={`${s.file.name} 인증 종류`}
                  value={s.certType}
                  disabled={busy || s.state === "uploading"}
                  onChange={(e) => update(s.key, { certType: e.target.value })}
                  className={inputCls}
                >
                  {certOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${s.file.name} 분류`}
                  value={s.category}
                  disabled={busy || s.state === "uploading"}
                  onChange={(e) => update(s.key, { category: e.target.value })}
                  className={inputCls}
                >
                  {categoryOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${s.file.name} 문서 형식`}
                  value={s.docFormat}
                  disabled={busy || s.state === "uploading"}
                  onChange={(e) => update(s.key, { docFormat: e.target.value })}
                  className={inputCls}
                >
                  <option value="narrative">설명 자료</option>
                  <option value="qa_pairs">질문·답변 자료</option>
                </select>
                <button
                  type="button"
                  aria-label={`${s.file.name} 목록에서 제거`}
                  disabled={busy}
                  onClick={() => setStaged((prev) => prev.filter((x) => x.key !== s.key))}
                  className="justify-self-end rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={upload} disabled={busy || pending === 0} className={btnPrimary}>
              {busy ? "올리는 중…" : `${pending}개 업로드`}
            </button>
            <button type="button" disabled={busy} onClick={() => setStaged([])} className="text-sm text-slate-600 hover:underline disabled:opacity-40">
              모두 비우기
            </button>
          </div>
        </div>
      )}
      {conflict && (
        <div role="dialog" aria-modal="true" aria-label="같은 이름의 문서" className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <p className="text-base font-bold text-slate-900">같은 이름의 문서가 있습니다</p>
            <p className="mt-2 break-words text-sm text-slate-700">
              <b>{conflict.fileName}</b> 은(는) 이미 올라가 있는 <b>{conflict.existing.file_name}</b> (v{conflict.existing.version}) 과 이름은 같고 내용이 다릅니다.
            </p>
            <p className="mt-1 text-xs text-slate-500">개정판으로 올리면 이전 버전은 &lsquo;이전 버전&rsquo;으로 보관되고, 그 문서로 만든 승인된 FAQ에 재검토 표시가 붙습니다.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" onClick={() => conflict.resolve("cancel")}>
                취소
              </button>
              <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" onClick={() => conflict.resolve("separate")}>
                별도 문서로 올리기
              </button>
              <button type="button" autoFocus className={btnPrimary} onClick={() => conflict.resolve("revise")}>
                개정판으로 올리기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
