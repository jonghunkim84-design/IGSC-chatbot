"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { runUploads } from "@/components/admin/upload-pipeline";
import { checkFile } from "@/lib/admin/documents";
import { deleteDocumentAction, reextractAction, reextractPendingAction } from "./actions";

const small = "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50";

/** 개정판 업로드: 이 문서를 골라 새 파일을 올리면 version+1, supersedes 연결, 이전 버전은 archived */
export function ReviseButton({ docId, fileName, version }: { docId: string; fileName: string; version: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onPick(file: File) {
    const check = checkFile(file.name, file.size);
    if (!check.ok) {
      setMessage({ ok: false, text: check.message });
      return;
    }
    if (!window.confirm(`'${fileName}' (v${version})의 개정판으로 '${file.name.normalize("NFC")}' 을(를) 올립니다.\n이전 버전은 '이전 버전'으로 보관 처리됩니다. 계속할까요?`)) return;
    setState("busy");
    setMessage(null);
    let error = "";
    const ok = await runUploads([{ file, certType: "", category: "", supersedesId: docId }], (_, s) => {
      if (s.state === "error") error = s.error ?? "";
    });
    setState("idle");
    if (ok === 1) {
      setMessage({ ok: true, text: `v${version + 1} 로 올렸습니다.` });
      router.refresh();
    } else {
      setMessage({ ok: false, text: error || "개정판을 올리지 못했습니다." });
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" className={small} disabled={state === "busy"} onClick={() => inputRef.current?.click()}>
        {state === "busy" ? "올리는 중…" : "개정판 올리기"}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={`${fileName} 개정판 파일 선택`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPick(f);
        }}
      />
      {message && (
        <span role="status" className={`max-w-[180px] text-xs ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}

/** 삭제 전 확인. 스토리지 파일과 DB 행이 함께 삭제된다. */
export function DeleteButton({ docId, fileName, linkedFaqs, returnTo }: { docId: string; fileName: string; linkedFaqs: number; returnTo: string }) {
  return (
    <form
      action={deleteDocumentAction}
      onSubmit={(e) => {
        const extra = linkedFaqs > 0 ? `\n이 문서에서 만든 FAQ ${linkedFaqs}건은 남지만 출처 문서 연결이 해제됩니다.` : "";
        if (!window.confirm(`'${fileName}' 을(를) 삭제할까요?\n저장된 파일과 목록 정보가 함께 삭제되며 되돌릴 수 없습니다.${extra}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={docId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
        삭제
      </button>
    </form>
  );
}

/** 텍스트 추출 수동 재실행 (기존 조각은 지우고 다시 만든다) */
export function ReextractButton({ docId, returnTo, label = "재추출" }: { docId: string; returnTo: string; label?: string }) {
  return (
    <form action={reextractAction}>
      <input type="hidden" name="id" value={docId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className={small}>
        {label}
      </button>
    </form>
  );
}

/** 추출 대기 문서 일괄 추출 */
export function ReextractPendingButton({ count, returnTo }: { count: number; returnTo: string }) {
  return (
    <form action={reextractPendingAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">
        추출 대기 {count}건 모두 추출
      </button>
    </form>
  );
}

/** 추출이 진행 중인 문서가 있으면 몇 초마다 목록을 새로 불러온다 (최대 약 2분) */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let n = 0;
    const t = setInterval(() => {
      router.refresh();
      if (++n >= 30) clearInterval(t);
    }, 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
