"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary } from "@/components/admin/ui";
import { confirmDocFormatAction, previewQaFormatAction, type QaPreview } from "./actions";

const small = "rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50";

/**
 * 질문·답변 문서 형식 확인: 추출된 쌍의 첫 3건을 미리보기로 보여주고 "형식이 맞습니까?" 확인을 받는다.
 * 확인해야 FAQ 초안을 만들 수 있다. 맞지 않으면 설명 자료로 바꿀 수 있다.
 */
export function QaFormatCheck({ docId, fileName }: { docId: string; fileName: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<QaPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewQaFormatAction(docId));
    } catch (err) {
      console.error("[documents] 형식 미리보기 실패:", err);
      setError("미리보기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    setBusy(false);
  }

  async function decide(decision: "confirm" | "narrative") {
    setBusy(true);
    setError("");
    const r = await confirmDocFormatAction(docId, decision);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {!preview && (
        <button type="button" className={small} disabled={busy} onClick={open}>
          {busy ? "불러오는 중…" : "형식 확인"}
        </button>
      )}
      <span className="max-w-[16rem] text-xs text-amber-900">질문·답변 문서입니다. 형식을 확인하면 FAQ 초안을 만들 수 있습니다.</span>
      {preview && (
        <div className="mt-1 w-[24rem] max-w-full rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm" role="dialog" aria-label={`${fileName} 형식 미리보기`}>
          {preview.total === 0 ? (
            <p className="text-red-700">질문·답변 쌍을 찾지 못했습니다. 문서가 &lsquo;Q: / A:&rsquo; 또는 2열 표 형식인지 확인하거나, 설명 자료로 바꿔 주세요.</p>
          ) : (
            <>
              <p className="font-semibold text-slate-800">
                질문·답변 {preview.total}건을 찾았습니다. 처음 {preview.first.length}건:
              </p>
              <ol className="mt-2 space-y-2">
                {preview.first.map((p, i) => (
                  <li key={i} className="rounded border border-slate-200 bg-slate-50 p-2">
                    <p className="font-medium text-slate-900">Q. {p.question}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">A. {p.answer || "(답변 없음)"}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-2 font-semibold text-slate-800">형식이 맞습니까?</p>
              <p className="text-slate-500">질문과 답변은 원문 그대로 가져옵니다(요약·수정 없음).</p>
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {preview.total > 0 && (
              <button type="button" className={`${btnPrimary} !px-3 !py-1.5 !text-xs`} disabled={busy} onClick={() => decide("confirm")}>
                형식이 맞습니다
              </button>
            )}
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => decide("narrative")}>
              설명 자료로 바꾸기
            </button>
            <button type="button" className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:underline" disabled={busy} onClick={() => setPreview(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {error && (
        <span role="alert" className="max-w-[16rem] text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
