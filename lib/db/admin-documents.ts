import "server-only";
import { createHash } from "node:crypto";
import { createServerClient } from "./server";
import type { DocFormat, DocumentRow } from "./types";
import { PAGE_SIZE } from "@/lib/admin/labels";
import {
  ALLOWED_TYPES,
  DOC_CATEGORIES,
  MAX_FILE_BYTES,
  checkFile,
  extensionOf,
  isValidStoragePath,
  normalizeFileName,
  type DocCategory,
} from "@/lib/admin/documents";

export const DOC_BUCKET = "documents";
/** 다운로드 서명 URL 유효기간(초). 짧게 유지한다. */
export const DOWNLOAD_URL_TTL = 60;

const storage = () => createServerClient().storage.from(DOC_BUCKET);

export interface DocFilter {
  status?: string;
  certType?: string;
  category?: string;
  page?: number;
}

export async function listDocuments(f: DocFilter): Promise<{ rows: DocumentRow[]; total: number; linkedFaqs: Map<string, number> }> {
  const page = Math.max(1, f.page ?? 1);
  const sb = createServerClient();
  let q = sb.from("documents").select("*", { count: "exact" });
  if (f.status) q = q.eq("status", f.status);
  if (f.certType) q = q.eq("cert_type", f.certType);
  if (f.category) q = q.eq("doc_category", f.category);
  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw error;
  const rows = (data ?? []) as DocumentRow[];

  // 이 페이지 문서에서 만든 FAQ 수 (삭제 확인 문구에 사용)
  const linkedFaqs = new Map<string, number>();
  if (rows.length) {
    const { data: faqs, error: e2 } = await sb.from("faq").select("source_doc_id").in("source_doc_id", rows.map((r) => r.id));
    if (e2) throw e2;
    for (const r of faqs ?? []) linkedFaqs.set(r.source_doc_id as string, (linkedFaqs.get(r.source_doc_id as string) ?? 0) + 1);
  }
  return { rows, total: count ?? 0, linkedFaqs };
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const { data, error } = await createServerClient().from("documents").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as DocumentRow | null) ?? null;
}

/** 브라우저가 스토리지에 직접 올릴 수 있는 서명 업로드 URL 발급 (Vercel 요청 본문 한도 회피) */
export async function createUploadTarget(path: string): Promise<{ token: string; path: string }> {
  const { data, error } = await storage().createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error("서명 업로드 URL 발급 실패");
  return { token: data.token, path: data.path };
}

/** 스토리지에 실제로 올라간 객체의 크기·형식 (클라이언트가 말한 값이 아니라 저장소 기준) */
export async function headObject(path: string): Promise<{ size: number; mimetype: string } | null> {
  const { data, error } = await storage().list("", { limit: 5, search: path });
  if (error) throw error;
  const hit = data?.find((o) => o.name === path);
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
  return { size: Number(meta.size ?? 0), mimetype: String(meta.mimetype ?? "") };
}

export async function removeObject(path: string): Promise<void> {
  const { error } = await storage().remove([path]);
  if (error) throw error;
}

export interface ConfirmItem {
  path: string;
  fileName: string;
  certType: string;
  category: string;
  /** 개정판이면 이전 버전 문서 id */
  supersedesId?: string;
  /** narrative(설명 자료, 기본) | qa_pairs(질문·답변이 정리된 자료). 개정판은 이전 문서의 형식을 이어받는다. */
  docFormat?: string;
  /** 같은 이름의 문서가 있어도 별도 문서로 올리기로 한 경우 */
  allowSameName?: boolean;
}

/** 문서 형식 변경·확인. qa_pairs 는 형식 확인(confirmed)을 받아야 FAQ 초안을 만들 수 있다. */
export async function setDocFormat(id: string, format: DocFormat, confirmed: boolean): Promise<boolean> {
  const { data, error } = await createServerClient().from("documents").update({ doc_format: format, format_confirmed: confirmed }).eq("id", id).neq("status", "archived").select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** 파일 내용 해시 (SHA-256, 소문자 16진수). 같은 파일의 중복 업로드를 막는 데 쓴다. */
export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export interface ExistingDocInfo {
  id: string;
  file_name: string;
  version: number;
  status: string;
  created_at: string;
}

const NFC = (s: string) => s.normalize("NFC");

/** 내용 해시가 같은 문서 (보관된 이전 버전 포함) */
export async function findDocByHash(hash: string): Promise<ExistingDocInfo | null> {
  const { data, error } = await createServerClient().from("documents").select("id, file_name, version, status, created_at").eq("content_hash", hash).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as ExistingDocInfo | undefined) ?? null;
}

/** 이름이 같은 최신 문서 (보관된 이전 버전 제외). 이름은 한글 정규화(NFC) 후 비교한다. */
export async function findLatestDocByName(fileName: string): Promise<ExistingDocInfo | null> {
  const name = NFC(fileName);
  const { data, error } = await createServerClient().from("documents").select("id, file_name, version, status, created_at").neq("status", "archived").order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ExistingDocInfo[]).find((d) => NFC(d.file_name) === name) ?? null;
}

const describeDoc = (d: ExistingDocInfo) => `'${d.file_name}' (v${d.version}${d.status === "archived" ? ", 이전 버전" : ""}, ${d.created_at.slice(0, 10)} 업로드)`;
export const duplicateMessage = (d: ExistingDocInfo) => `같은 내용의 파일이 이미 있습니다: ${describeDoc(d)}. 문서 보관함 목록에서 확인해 주세요.`;

export type ConfirmResult = { ok: true; doc: DocumentRow } | { ok: false; error: string };

/**
 * 업로드가 끝난 파일을 문서로 등록한다.
 * - 스토리지에 실제로 있는지, 크기·형식이 허용 범위인지 저장소 기준으로 다시 확인
 * - 개정판이면: 이전 버전(최신본만 가능)의 version+1, supersedes 연결, 이전 버전 status='archived'
 * - 실패하면 올라간 파일을 지워 고아 파일이 남지 않게 한다.
 */
export async function confirmUpload(item: ConfirmItem, uploadedBy: string, knownCertTypes: (slug: string) => boolean): Promise<ConfirmResult> {
  const sb = createServerClient();
  const fail = async (error: string): Promise<ConfirmResult> => {
    try {
      await removeObject(item.path);
    } catch (e) {
      console.error("[documents] 실패한 업로드 파일 정리 실패:", item.path, e);
    }
    return { ok: false, error };
  };

  if (!isValidStoragePath(item.path)) return { ok: false, error: "올바르지 않은 파일 경로입니다." };
  const fileName = normalizeFileName(item.fileName);
  const check = checkFile(fileName, 1);
  if (!check.ok && check.code !== "empty") return fail(check.message);
  const ext = extensionOf(item.path);
  if (extensionOf(fileName) !== ext) return fail("파일 형식이 일치하지 않습니다.");

  const obj = await headObject(item.path);
  if (!obj) return { ok: false, error: "업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요." };
  if (obj.size <= 0) return fail("빈 파일은 올릴 수 없습니다.");
  if (obj.size > MAX_FILE_BYTES) return fail("파일이 20MB를 넘습니다.");

  // 내용 해시는 클라이언트가 말한 값이 아니라 저장소에 올라간 파일에서 직접 계산한다 (같은 파일의 중복 업로드 차단)
  const { data: blob, error: dlErr } = await sb.storage.from(DOC_BUCKET).download(item.path);
  if (dlErr || !blob) {
    console.error("[documents] 해시 계산용 파일 내려받기 실패:", item.path, dlErr);
    return fail("올린 파일을 확인하지 못했습니다. 다시 시도해 주세요.");
  }
  const contentHash = sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  const sameContent = await findDocByHash(contentHash);
  if (sameContent) return fail(duplicateMessage(sameContent));
  if (!item.supersedesId && !item.allowSameName) {
    const sameName = await findLatestDocByName(fileName);
    if (sameName) return fail(`같은 이름의 문서가 이미 있습니다: ${describeDoc(sameName)}. 개정판으로 올리거나 별도 문서로 올리기를 선택해 주세요.`);
  }

  let certType = item.certType || "common";
  let category = (DOC_CATEGORIES as readonly string[]).includes(item.category) ? (item.category as DocCategory) : "other";
  let version = 1;
  let supersedes: string | null = null;
  let docFormat: DocFormat = item.docFormat === "qa_pairs" ? "qa_pairs" : "narrative";
  let formatConfirmed = docFormat === "narrative";

  if (item.supersedesId) {
    const { data: prev, error } = await sb.from("documents").select("*").eq("id", item.supersedesId).maybeSingle();
    if (error) {
      console.error("[documents] 이전 버전 조회 실패:", error);
      return fail("이전 버전을 확인하지 못했습니다.");
    }
    if (!prev) return fail("개정할 문서를 찾을 수 없습니다.");
    if (prev.status === "archived") return fail("이미 개정된 이전 버전입니다. 최신 버전을 선택해 주세요.");
    version = (prev.version as number) + 1;
    supersedes = prev.id as string;
    certType = prev.cert_type as string; // 개정판은 이전 문서의 인증 종류·분류를 이어받는다
    category = prev.doc_category as DocCategory;
    docFormat = (prev.doc_format as DocFormat | undefined) ?? "narrative"; // 개정판은 이전 문서의 형식·확인 상태를 이어받는다
    formatConfirmed = (prev.format_confirmed as boolean | undefined) ?? true;
  } else if (!knownCertTypes(certType)) {
    return fail("인증 종류를 선택해 주세요.");
  }

  const { data: doc, error: insErr } = await sb
    .from("documents")
    .insert({
      file_name: fileName,
      storage_path: item.path,
      mime_type: ALLOWED_TYPES[ext],
      file_size: obj.size,
      cert_type: certType,
      doc_category: category,
      version,
      supersedes,
      status: "pending",
      content_hash: contentHash,
      doc_format: docFormat,
      format_confirmed: formatConfirmed,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();
  if (insErr || !doc) {
    console.error("[documents] 문서 등록 실패:", insErr);
    return fail("문서를 등록하지 못했습니다.");
  }

  if (supersedes) {
    const { error: archErr } = await sb.from("documents").update({ status: "archived" }).eq("id", supersedes);
    if (archErr) {
      // 새 버전만 남고 이전 버전이 보관 처리되지 않은 상태 — 새 문서를 되돌려 일관성을 유지한다
      console.error("[documents] 이전 버전 보관 처리 실패:", archErr);
      await sb.from("documents").delete().eq("id", (doc as DocumentRow).id);
      return fail("이전 버전을 보관 처리하지 못해 업로드를 취소했습니다.");
    }
  }
  return { ok: true, doc: doc as DocumentRow };
}

/** 스토리지 파일과 DB 행을 함께 삭제. 파일 삭제가 실패하면 행을 지우지 않는다. */
export async function deleteDocumentAdmin(id: string): Promise<{ ok: true; linkedFaqs: number } | { ok: false; error: string }> {
  const sb = createServerClient();
  const doc = await getDocument(id);
  if (!doc) return { ok: false, error: "문서를 찾을 수 없습니다." };
  const { count } = await sb.from("faq").select("id", { count: "exact", head: true }).eq("source_doc_id", id);
  try {
    await removeObject(doc.storage_path);
  } catch (e) {
    console.error("[documents] 스토리지 파일 삭제 실패:", e);
    return { ok: false, error: "저장소에서 파일을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const { error } = await sb.from("documents").delete().eq("id", id);
  if (error) {
    console.error("[documents] 문서 행 삭제 실패:", error);
    return { ok: false, error: "문서 정보를 삭제하지 못했습니다." };
  }
  return { ok: true, linkedFaqs: count ?? 0 };
}

/**
 * 짧은 유효기간의 다운로드 URL. 원본 한글 파일명으로 내려받도록 지정한다.
 * supabase-js 의 download 옵션은 한글 이름을 두 번 인코딩해 파일명이 깨지므로(filename*=UTF-8''%25EC…),
 * 서명 URL 을 받은 뒤 download 파라미터를 직접 한 번만 인코딩해 붙인다.
 */
export async function createDownloadUrl(doc: DocumentRow): Promise<string> {
  const { data, error } = await storage().createSignedUrl(doc.storage_path, DOWNLOAD_URL_TTL);
  if (error || !data) throw error ?? new Error("다운로드 URL 발급 실패");
  return `${data.signedUrl}&download=${encodeURIComponent(doc.file_name)}`;
}
