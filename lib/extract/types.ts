/** 문서에서 뽑은 구조 단위. 형식별 추출기가 만들고, chunk.ts 가 검색 가능한 조각으로 묶는다. */
export type Block =
  | { kind: "heading"; text: string; level: number; page?: number | null }
  /** atomic: 행 단위 텍스트(엑셀·CSV)처럼 중간에서 자르거나 앞뒤 중첩을 붙이지 않을 문단 */
  | { kind: "para"; text: string; page?: number | null; atomic?: boolean }
  | { kind: "table"; rows: string[][]; page?: number | null };

export interface Chunk {
  chunk_index: number;
  content: string;
  /** PDF 는 페이지, PPTX 는 슬라이드 번호, 그 외는 null */
  page_no: number | null;
  section_title: string | null;
}

export type ExtractErrorCode = "scanned" | "empty" | "encrypted" | "corrupt" | "garbled" | "too_long";

/** 고객(관리자)에게 그대로 보여줄 실패 사유 */
export const EXTRACT_MESSAGES: Record<ExtractErrorCode, string> = {
  scanned: "텍스트가 거의 추출되지 않았습니다. 스캔 문서로 보입니다. 텍스트가 있는 원본 파일을 올려 주세요",
  empty: "문서에서 추출할 수 있는 텍스트가 없습니다. 내용이 있는 파일을 올려주세요.",
  encrypted: "암호로 보호된 파일입니다. 암호를 해제한 파일을 올려주세요.",
  corrupt: "파일을 읽을 수 없습니다. 파일이 손상되었거나 형식이 올바르지 않을 수 있습니다.",
  garbled: "글자를 올바르게 읽을 수 없는 문서입니다(글꼴 정보가 없는 PDF일 수 있습니다). 텍스트가 있는 다른 파일로 올려주세요.",
  too_long: "문서가 너무 깁니다. 나누어서 올려주세요.",
};

export class ExtractError extends Error {
  constructor(public code: ExtractErrorCode, message?: string) {
    super(message ?? EXTRACT_MESSAGES[code]);
    this.name = "ExtractError";
  }
}
