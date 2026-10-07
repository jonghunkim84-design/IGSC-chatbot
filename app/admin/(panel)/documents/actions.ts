"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { hasCertName } from "@/lib/cert-names";
import { ensureCertNames } from "@/lib/cert-registry";
import { requireAdmin } from "@/lib/admin/guard";
import {
  DOC_CATEGORIES,
  MAX_FILES_PER_BATCH,
  checkFile,
  isValidStoragePath,
  normalizeFileName,
  storagePathFor,
} from "@/lib/admin/documents";
import { listPendingDocumentIds, runExtraction, runExtractions } from "@/lib/db/admin-doc-extract";
import { loadQaPairs } from "@/lib/docs/qa-source";
import { QA_PREVIEW_COUNT } from "@/lib/ingest/config";
import {
  confirmUpload,
  duplicateMessage,
  findDocByHash,
  findLatestDocByName,
  getDocument,
  setDocFormat,
  createUploadTarget,
  deleteDocumentAdmin,
  removeObject,
  type ConfirmItem,
  type ConfirmResult,
  type ExistingDocInfo,
} from "@/lib/db/admin-documents";

export interface PrepareItem {
  fileName: string;
  size: number;
  certType: string;
  category: string;
  /** 개정판이면 이전 버전 문서 id */
  supersedesId?: string;
  /** 파일 내용 SHA-256(소문자 16진수). 같은 파일의 중복 업로드를 막는 데 쓴다. */
  hash?: string;
  /** 같은 이름의 문서가 있어도 별도 문서로 올리기로 한 경우 */
  allowSameName?: boolean;
}

export type PrepareResult =
  | { ok: true; path: string; token: string; contentType: string; fileName: string }
  | { ok: false; error: string; code?: string; existing?: ExistingDocInfo };

const HASH = /^[0-9a-f]{64}$/;

export type PreflightResult = { status: "ok" } | { status: "duplicate" | "name_conflict"; existing: ExistingDocInfo; message: string };

/**
 * 올리기 전 확인: 내용이 같은 파일이 이미 있으면 차단(duplicate), 내용은 다르고 이름만 같은 문서가 있으면 선택지를 띄우도록 알린다(name_conflict).
 * 업로드 단계(prepare/confirm)에서도 같은 검사를 다시 하므로 이 확인을 건너뛰어도 중복은 막힌다.
 */
export async function preflightUploadsAction(items: { fileName: string; hash: string }[]): Promise<PreflightResult[]> {
  await requireAdmin();
  if (!Array.isArray(items) || items.length > MAX_FILES_PER_BATCH) return [];
  const out: PreflightResult[] = [];
  for (const it of items) {
    const same = HASH.test(String(it.hash)) ? await findDocByHash(String(it.hash)) : null;
    if (same) {
      out.push({ status: "duplicate", existing: same, message: duplicateMessage(same) });
      continue;
    }
    const byName = await findLatestDocByName(normalizeFileName(String(it.fileName ?? "")));
    out.push(byName ? { status: "name_conflict", existing: byName, message: `같은 이름의 문서가 있습니다: '${byName.file_name}' (v${byName.version})` } : { status: "ok" });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 1단계: 파일 정보를 검사하고 파일마다 uuid 기반 저장 경로 + 서명 업로드 URL 토큰을 발급한다.
 * (파일 본문은 서버를 거치지 않고 브라우저가 스토리지에 직접 올린다.)
 */
export async function prepareUploadsAction(items: PrepareItem[]): Promise<PrepareResult[]> {
  await requireAdmin();
  await ensureCertNames();
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length > MAX_FILES_PER_BATCH) {
    return items.map(() => ({ ok: false as const, error: `한 번에 ${MAX_FILES_PER_BATCH}개까지 올릴 수 있습니다.` }));
  }

  const out: PrepareResult[] = [];
  for (const it of items) {
    const fileName = normalizeFileName(String(it.fileName ?? ""));
    const check = checkFile(fileName, Number(it.size));
    if (!check.ok) {
      out.push({ ok: false, error: check.message, code: check.code });
      continue;
    }
    const sameContent = it.hash && HASH.test(it.hash) ? await findDocByHash(it.hash) : null;
    if (sameContent) {
      out.push({ ok: false, code: "duplicate", error: duplicateMessage(sameContent), existing: sameContent });
      continue;
    }
    if (!it.supersedesId && !it.allowSameName) {
      const sameName = await findLatestDocByName(fileName);
      if (sameName) {
        out.push({ ok: false, code: "name_conflict", error: `같은 이름의 문서가 이미 있습니다: '${sameName.file_name}' (v${sameName.version}). 개정판으로 올리거나 별도 문서로 올리기를 선택해 주세요.`, existing: sameName });
        continue;
      }
    }
    if (it.supersedesId) {
      if (!UUID.test(it.supersedesId)) {
        out.push({ ok: false, error: "개정할 문서가 올바르지 않습니다." });
        continue;
      }
    } else if (!hasCertName(it.certType || "common")) {
      out.push({ ok: false, error: "인증 종류를 선택해 주세요." });
      continue;
    }
    if (!(DOC_CATEGORIES as readonly string[]).includes(it.category) && !it.supersedesId) {
      out.push({ ok: false, error: "분류를 선택해 주세요." });
      continue;
    }
    try {
      const path = storagePathFor(randomUUID(), check.ext);
      const target = await createUploadTarget(path);
      out.push({ ok: true, path: target.path, token: target.token, contentType: check.contentType, fileName });
    } catch (err) {
      console.error("[documents] 서명 업로드 URL 발급 실패:", err);
      out.push({ ok: false, error: "업로드를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }
  return out;
}

/** 2단계(업로드 완료 후): 스토리지에 실제로 올라갔는지 확인하고 문서로 등록한다. 개정판이면 이전 버전을 보관 처리한다. */
export async function confirmUploadsAction(items: ConfirmItem[]): Promise<ConfirmResult[]> {
  const { email } = await requireAdmin();
  await ensureCertNames();
  if (!Array.isArray(items) || items.length > MAX_FILES_PER_BATCH) return [];
  const results: ConfirmResult[] = [];
  for (const it of items) {
    try {
      results.push(await confirmUpload(it, email, hasCertName));
    } catch (err) {
      console.error("[documents] 문서 등록 중 오류:", err);
      try {
        if (isValidStoragePath(it.path)) await removeObject(it.path);
      } catch {
        /* 정리 실패는 위에서 로깅됨 */
      }
      results.push({ ok: false, error: "문서를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }
  // 업로드 직후 자동 추출 (응답을 보낸 뒤 백그라운드에서 실행). 추출이 실패해도 업로드는 그대로 유지된다.
  const ids = results.flatMap((r) => (r.ok ? [r.doc.id] : []));
  if (ids.length) after(() => runExtractions(ids));
  return results;
}

/** 업로드에 실패한 파일이 스토리지에 남았을 수 있어 브라우저가 정리를 요청한다 (등록되지 않은 경로만 지운다). */
export async function discardUploadsAction(paths: string[]): Promise<void> {
  await requireAdmin();
  for (const p of Array.isArray(paths) ? paths.slice(0, MAX_FILES_PER_BATCH) : []) {
    if (!isValidStoragePath(p)) continue;
    try {
      await removeObject(p);
    } catch (err) {
      console.error("[documents] 미등록 파일 정리 실패:", p, err);
    }
  }
}

/** 텍스트 추출 수동 재실행. 기존 조각은 지우고 다시 만든다. */
export async function reextractAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("returnTo") ?? "/admin/documents");
  const safeBack = back.startsWith("/admin/documents") ? back : "/admin/documents";
  const sep = safeBack.includes("?") ? "&" : "?";
  if (!UUID.test(id)) redirect(`${safeBack}${sep}msg=error`);
  const doc = await getDocument(id);
  if (!doc) redirect(`${safeBack}${sep}msg=error`);
  if (doc.status === "archived") redirect(`${safeBack}${sep}msg=reextract_archived`);
  after(() => runExtraction(id));
  redirect(`${safeBack}${sep}msg=reextract`);
}

/** 추출 대기 중인 문서를 한꺼번에 추출 (한 번에 최대 10건) */
export async function reextractPendingAction(formData: FormData) {
  await requireAdmin();
  const back = String(formData.get("returnTo") ?? "/admin/documents");
  const safeBack = back.startsWith("/admin/documents") ? back : "/admin/documents";
  const sep = safeBack.includes("?") ? "&" : "?";
  const ids = await listPendingDocumentIds(10);
  if (ids.length) after(() => runExtractions(ids));
  redirect(`${safeBack}${sep}msg=reextract_pending&n=${ids.length}`);
}

/** 스토리지 파일과 DB 행을 함께 삭제한다. */
export async function deleteDocumentAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("returnTo") ?? "/admin/documents");
  const safeBack = back.startsWith("/admin/documents") ? back : "/admin/documents";
  const sep = safeBack.includes("?") ? "&" : "?";
  if (!UUID.test(id)) redirect(`${safeBack}${sep}msg=error`);
  const res = await deleteDocumentAdmin(id);
  if (!res.ok) redirect(`${safeBack}${sep}msg=delete_failed`);
  redirect(`${safeBack}${sep}msg=deleted&faqs=${res.linkedFaqs}`);
}


export interface QaPreview {
  total: number;
  first: { question: string; answer: string }[];
}

/** 질문·답변 문서의 형식 확인용 미리보기: 원문에서 읽은 쌍의 개수와 첫 3건 (질문·답변은 원문 그대로) */
export async function previewQaFormatAction(documentId: string): Promise<QaPreview> {
  await requireAdmin();
  if (!UUID.test(documentId)) return { total: 0, first: [] };
  const doc = await getDocument(documentId);
  if (!doc || doc.status !== "extracted") return { total: 0, first: [] };
  const pairs = await loadQaPairs(doc);
  return { total: pairs.length, first: pairs.slice(0, QA_PREVIEW_COUNT).map((p) => ({ question: p.question, answer: p.answer.slice(0, 600) })) };
}

/** 형식 확인 결과: confirm = 질문·답변 형식이 맞음(FAQ 초안 만들기 가능), narrative = 설명 자료로 바꿈 */
export async function confirmDocFormatAction(documentId: string, decision: "confirm" | "narrative"): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!UUID.test(documentId) || (decision !== "confirm" && decision !== "narrative")) return { ok: false, error: "올바르지 않은 요청입니다." };
  try {
    const ok = decision === "confirm" ? await setDocFormat(documentId, "qa_pairs", true) : await setDocFormat(documentId, "narrative", true);
    return ok ? { ok: true } : { ok: false, error: "문서를 찾을 수 없거나 이전 버전입니다." };
  } catch (err) {
    console.error("[documents] 형식 확인 저장 실패:", err);
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
