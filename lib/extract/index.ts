import { chunkBlocks } from "./chunk";
import { extractDocx } from "./docx";
import { extractMd, extractTxt } from "./plain";
import { extractPdfDetailed } from "./pdf";
import { extractPptx } from "./pptx";
import { extractCsv, extractXlsx } from "./sheet";
import { ExtractError, type Block, type Chunk } from "./types";

export { ExtractError, EXTRACT_MESSAGES } from "./types";
export type { Block, Chunk } from "./types";

const MAX_CHUNKS = 3000;

export interface ExtractMetrics {
  /** 공백을 뺀 추출 글자 수 */
  chars: number;
  /** PDF 는 페이지 수, PPTX 는 슬라이드 수, 그 외는 null */
  pages: number | null;
  /** PDF: 페이지당 평균 글자 수 / 그 외: 파일 크기 1KB 당 추출 글자 수 */
  density: number;
}

const blockChars = (b: Block): number => (b.kind === "table" ? b.rows.flat().join("").replace(/\s/g, "").length : b.text.replace(/\s/g, "").length);

async function blocksFor(bytes: Uint8Array, ext: string): Promise<Block[]> {
  return (await blocksWithMetrics(bytes, ext)).blocks;
}

async function blocksWithMetrics(bytes: Uint8Array, ext: string): Promise<{ blocks: Block[]; pages: number | null }> {
  switch (ext) {
    case "pdf": {
      const r = await extractPdfDetailed(bytes);
      return { blocks: r.blocks, pages: r.totalPages };
    }
    default:
      return { blocks: await plainBlocks(bytes, ext), pages: null };
  }
}

async function plainBlocks(bytes: Uint8Array, ext: string): Promise<Block[]> {
  switch (ext) {
    case "docx":
      return extractDocx(bytes);
    case "xlsx":
      return extractXlsx(bytes);
    case "pptx":
      return extractPptx(bytes);
    case "csv":
      return extractCsv(bytes);
    case "txt":
      return extractTxt(bytes);
    case "md":
      return extractMd(bytes);
    default:
      throw new ExtractError("corrupt");
  }
}

/**
 * 파일 → 검색 가능한 조각. 텍스트가 없으면 ExtractError('scanned' | 'empty' …) 를 던진다.
 * 임베딩은 만들지 않는다.
 */
export async function extractChunks(bytes: Uint8Array, ext: string): Promise<Chunk[]> {
  return (await extractWithMetrics(bytes, ext)).chunks;
}

/** 원문 블록(문단·표·제목)을 그대로 읽는다. 질문·답변 쌍 문서를 파싱할 때 쓴다. */
export async function extractBlocks(bytes: Uint8Array, ext: string): Promise<Block[]> {
  try {
    return await blocksFor(bytes, ext.toLowerCase());
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    console.error(`[extract] ${ext} 처리 중 예기치 않은 오류:`, e);
    throw new ExtractError("corrupt");
  }
}

/** 조각과 함께 추출 품질 지표를 돌려준다 (PDF 는 페이지당 글자 수 기준으로 이미 걸러진다). */
export async function extractWithMetrics(bytes: Uint8Array, ext: string): Promise<{ chunks: Chunk[]; metrics: ExtractMetrics }> {
  let blocks: Block[];
  let pages: number | null;
  try {
    ({ blocks, pages } = await blocksWithMetrics(bytes, ext.toLowerCase()));
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    console.error(`[extract] ${ext} 처리 중 예기치 않은 오류:`, e);
    throw new ExtractError("corrupt");
  }
  const chunks = chunkBlocks(blocks);
  if (chunks.length === 0) throw new ExtractError(ext === "pdf" ? "scanned" : "empty");
  if (chunks.length > MAX_CHUNKS) throw new ExtractError("too_long");
  const chars = blocks.reduce((n, b) => n + blockChars(b), 0);
  const density = ext.toLowerCase() === "pdf" && pages ? chars / pages : chars / Math.max(1, bytes.length / 1024);
  return { chunks, metrics: { chars, pages, density } };
}
