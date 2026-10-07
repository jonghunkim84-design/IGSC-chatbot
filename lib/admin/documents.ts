/**
 * 문서 보관함 공용 규칙 (브라우저 업로드 화면과 서버 액션이 같은 규칙을 쓴다).
 * 서버 전용 코드를 import 하지 않는다.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 1개 파일 20MB
export const MAX_FILES_PER_BATCH = 20;

/** 허용 형식: 확장자 → 스토리지에 올릴 때 지정하는 Content-Type (버킷 허용 목록과 동일) */
export const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

export const ALLOWED_EXT_LABEL = "PDF, DOCX, XLSX, PPTX, CSV, TXT, MD";
export const HWP_EXTENSIONS = ["hwp", "hwpx"];

export const MSG_HWP_REJECTED = "HWP/HWPX 파일은 올릴 수 없습니다. 한글에서 PDF로 저장한 뒤 올려 주세요.";

export const DOC_CATEGORIES = ["procedure", "fee", "form", "policy", "other"] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type FileCheck =
  | { ok: true; ext: string; contentType: string }
  | { ok: false; code: "hwp" | "ext" | "size" | "empty" | "name"; message: string };

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/**
 * 화면에 보여줄 원본 파일명 정리.
 * - 한글 자모가 분리된 형태(macOS 의 NFD)를 완성형(NFC)으로 합쳐 글자가 깨지지 않게 한다.
 * - 경로 구분자·제어문자 제거, 길이 제한. 공백과 한글은 그대로 둔다.
 */
export function normalizeFileName(name: string): string {
  const base = name.normalize("NFC").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length <= 200) return cleaned;
  const ext = extensionOf(cleaned);
  return cleaned.slice(0, 200 - (ext ? ext.length + 1 : 0)) + (ext ? `.${ext}` : "");
}

/** 업로드 전 검사: 형식(HWP 는 별도 안내), 크기, 빈 파일 */
export function checkFile(fileName: string, size: number): FileCheck {
  const name = normalizeFileName(fileName);
  if (!name) return { ok: false, code: "name", message: "파일 이름을 확인할 수 없습니다." };
  const ext = extensionOf(name);
  if (HWP_EXTENSIONS.includes(ext)) return { ok: false, code: "hwp", message: MSG_HWP_REJECTED };
  const contentType = ALLOWED_TYPES[ext];
  if (!contentType) {
    return { ok: false, code: "ext", message: `지원하지 않는 형식입니다. (${ALLOWED_EXT_LABEL} 만 올릴 수 있습니다)` };
  }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, code: "empty", message: "빈 파일은 올릴 수 없습니다." };
  if (size > MAX_FILE_BYTES) {
    return { ok: false, code: "size", message: `파일이 너무 큽니다. (${formatBytes(size)} / 최대 ${MAX_FILE_BYTES / 1024 / 1024}MB)` };
  }
  return { ok: true, ext, contentType };
}

/** 스토리지 경로: 파일명과 무관한 uuid 기반 (한글·공백 파일명이 경로 문제를 일으키지 않게) */
export function storagePathFor(id: string, ext: string): string {
  return `${id}.${ext}`;
}

const STORAGE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]{2,5})$/;

/** 서버가 발급한 형식의 경로인지 (확인 단계에서 임의 경로를 받지 않기 위함) */
export function isValidStoragePath(path: string): boolean {
  const m = STORAGE_PATH_RE.exec(path);
  return !!m && m[1] in ALLOWED_TYPES;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
