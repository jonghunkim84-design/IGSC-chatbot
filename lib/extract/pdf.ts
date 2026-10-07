import { extractText, getDocumentProxy } from "unpdf";
import { MSG_PDF_SCANNED, PDF_MIN_CHARS_PER_PAGE } from "@/lib/ingest/config";
import { cleanText, looksGarbled } from "./text";
import { ExtractError, type Block } from "./types";

const LIST_START = /^(?:[-•·●▪■□○◦※]|\(?\d{1,2}[.)]|\(?[가-힣]\.|[①-⑳]|[IVX]{1,4}\.)\s*/;
const SENTENCE_END = /(?:[.!?。]|다|요|음|함)$/;

/**
 * PDF 는 줄 단위로 나오므로(화면 폭에서 줄바꿈된 상태) 문단을 다시 이어 붙인다.
 * 빈 줄, 목록 시작(1. / - / ① 등), 짧은 줄로 끝난 문장 뒤에서 문단을 끊고 나머지는 한 문단으로 잇는다.
 */
export function linesToParagraphs(pageText: string): string[] {
  const lines = pageText.split("\n").map((l) => l.trim());
  const maxLen = Math.max(0, ...lines.map((l) => l.length));
  const paras: string[] = [];
  let cur = "";
  let prev = "";
  for (const line of lines) {
    if (!line) {
      if (cur) paras.push(cur);
      cur = "";
      prev = "";
      continue;
    }
    const startsNew = !!prev && (LIST_START.test(line) || (SENTENCE_END.test(prev) && prev.length < maxLen * 0.75));
    if (startsNew) {
      paras.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur} ${line}` : line;
    }
    prev = line;
  }
  if (cur) paras.push(cur);
  return paras;
}

function isPasswordError(e: unknown): boolean {
  const err = e as { name?: string; message?: string };
  return err?.name === "PasswordException" || /password/i.test(err?.message ?? "");
}

export interface PdfExtraction {
  blocks: Block[];
  totalPages: number;
  /** 공백을 뺀 전체 글자 수 */
  totalChars: number;
}

export async function extractPdf(bytes: Uint8Array): Promise<Block[]> {
  return (await extractPdfDetailed(bytes)).blocks;
}

/**
 * 텍스트 레이어를 페이지별로 추출한다 (OCR 은 하지 않는다).
 * 품질 기준: 페이지당 평균 글자 수(공백 제외)가 PDF_MIN_CHARS_PER_PAGE(lib/ingest/config.ts) 미만이면 스캔 문서로 보고 실패시킨다.
 */
export async function extractPdfDetailed(bytes: Uint8Array): Promise<PdfExtraction> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes)); // pdf.js 가 버퍼를 가져가므로 복사본을 넘긴다
  } catch (e) {
    throw new ExtractError(isPasswordError(e) ? "encrypted" : "corrupt");
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(text) ? text : [text]).map(cleanText);
    const totalChars = pages.reduce((n, t) => n + t.replace(/\s/g, "").length, 0);
    if (totalChars / Math.max(1, totalPages) < PDF_MIN_CHARS_PER_PAGE) throw new ExtractError("scanned", MSG_PDF_SCANNED);
    if (looksGarbled(pages.join("\n"))) throw new ExtractError("garbled");

    const blocks: Block[] = [];
    pages.forEach((pageText, i) => {
      for (const p of linesToParagraphs(pageText)) blocks.push({ kind: "para", text: p, page: i + 1 });
    });
    return { blocks, totalPages, totalChars };
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    if (isPasswordError(e)) throw new ExtractError("encrypted");
    console.error("[extract] PDF 텍스트 추출 오류:", e);
    throw new ExtractError("corrupt");
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}
