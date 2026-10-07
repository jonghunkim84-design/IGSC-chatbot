"use client";

import { createBrowserClient } from "@/lib/db/client";
import { sha256File } from "@/lib/admin/file-hash";
import {
  confirmUploadsAction,
  discardUploadsAction,
  prepareUploadsAction,
  type PrepareResult,
} from "@/app/admin/(panel)/documents/actions";

export interface UploadItem {
  file: File;
  certType: string;
  category: string;
  supersedesId?: string;
  /** narrative(설명 자료) | qa_pairs(질문·답변이 정리된 자료). 개정판은 이전 문서의 형식을 이어받는다. */
  docFormat?: string;
  /** 같은 이름의 문서가 있어도 별도 문서로 올리기로 한 경우 */
  allowSameName?: boolean;
  /** 파일 내용 SHA-256. 없으면 올리기 직전에 계산한다. */
  hash?: string;
}

export type UploadState = { state: "uploading" | "done" | "error"; error?: string };

const CONCURRENCY = 3;
const BUCKET = "documents";

/**
 * 업로드 흐름 (파일 본문은 Vercel 서버를 거치지 않는다)
 *  1. 서버: 검사 + 저장 경로/서명 토큰 발급   2. 브라우저 → 스토리지 직접 업로드   3. 서버: 실제 업로드 확인 후 문서 등록
 */
export async function runUploads(items: UploadItem[], onUpdate: (index: number, s: UploadState) => void): Promise<number> {
  items.forEach((_, i) => onUpdate(i, { state: "uploading" }));

  // 같은 내용의 파일이 이미 있는지 서버가 확인할 수 있게 내용 해시를 계산한다 (서버가 저장된 파일로 다시 계산해 확인한다)
  try {
    for (const it of items) it.hash ??= await sha256File(it.file);
  } catch (err) {
    console.error("[documents] 파일 해시 계산 실패:", err);
    items.forEach((_, i) => onUpdate(i, { state: "error", error: "파일을 읽지 못했습니다. 파일이 열려 있거나 바뀌었다면 닫고 다시 선택해 주세요." }));
    return 0;
  }

  let prepared: PrepareResult[];
  try {
    prepared = await prepareUploadsAction(
      items.map((it) => ({ fileName: it.file.name, size: it.file.size, certType: it.certType, category: it.category, supersedesId: it.supersedesId, hash: it.hash, allowSameName: it.allowSameName })),
    );
  } catch (err) {
    console.error("[documents] 업로드 준비 실패:", err);
    items.forEach((_, i) => onUpdate(i, { state: "error", error: "업로드를 준비하지 못했습니다." }));
    return 0;
  }

  const storage = createBrowserClient().storage.from(BUCKET);
  const uploadedIdx: number[] = [];
  const failedPaths: string[] = [];

  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const p = prepared[i];
      if (!p || !p.ok) {
        onUpdate(i, { state: "error", error: p && !p.ok ? p.error : "업로드를 준비하지 못했습니다." });
        continue;
      }
      // 브라우저가 알려주는 file.type 은 PC에 설치된 프로그램에 따라 다르다(예: 한컴오피스 → application/haansoftpptx).
      // 저장소는 이 값을 그대로 검사하므로, 확장자로 정한 형식(p.contentType)으로 감싼 파일을 올린다.
      const body = new File([items[i].file], items[i].file.name, { type: p.contentType });
      const { error } = await storage.uploadToSignedUrl(p.path, p.token, body, { contentType: p.contentType });
      if (error) {
        console.error("[documents] 스토리지 업로드 실패:", error);
        failedPaths.push(p.path);
        onUpdate(i, { state: "error", error: "파일을 올리지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요." });
      } else {
        uploadedIdx.push(i);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  if (failedPaths.length) void discardUploadsAction(failedPaths).catch(() => {});

  if (uploadedIdx.length === 0) return 0;
  let confirmed;
  try {
    confirmed = await confirmUploadsAction(
      uploadedIdx.map((i) => {
        const p = prepared[i];
        if (!p.ok) throw new Error("unreachable");
        return { path: p.path, fileName: p.fileName, certType: items[i].certType, category: items[i].category, supersedesId: items[i].supersedesId, docFormat: items[i].docFormat, allowSameName: items[i].allowSameName };
      }),
    );
  } catch (err) {
    console.error("[documents] 문서 등록 실패:", err);
    uploadedIdx.forEach((i) => onUpdate(i, { state: "error", error: "문서를 등록하지 못했습니다." }));
    return 0;
  }

  let ok = 0;
  uploadedIdx.forEach((i, k) => {
    const r = confirmed[k];
    if (r?.ok) {
      ok++;
      onUpdate(i, { state: "done" });
    } else {
      onUpdate(i, { state: "error", error: r && !r.ok ? r.error : "문서를 등록하지 못했습니다." });
    }
  });
  return ok;
}
