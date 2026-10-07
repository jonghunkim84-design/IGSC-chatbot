/** 텍스트 정리·인코딩 공용 함수 */

/**
 * DB 에 저장할 텍스트 정리.
 * - 한글 자모가 분리된 형태(NFD)를 완성형(NFC)으로 합친다
 * - NUL 등 제어문자 제거 (PostgreSQL text 는 NUL 을 저장하지 못한다)
 * - 줄 안의 연속 공백을 하나로, 3줄 이상 연속 빈 줄을 하나로 줄인다
 */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​﻿]/g, "")
    .replace(/[ 　]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 글자가 깨진 텍스트인지 (대체문자 U+FFFD, 사용자 정의 영역 글자 비율). 글꼴 정보가 없는 PDF 에서 나타난다. */
export function looksGarbled(text: string): boolean {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length < 20) return false;
  let bad = 0;
  for (const ch of chars) {
    const c = ch.codePointAt(0)!;
    if (c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff)) bad++;
  }
  return bad / chars.length > 0.2;
}

/**
 * 바이트를 문자열로. UTF-8(BOM 포함)을 먼저 시도하고, 아니면 한국어 Windows 기본 인코딩(CP949/EUC-KR)으로 읽는다.
 * (윈도우 메모장·엑셀이 만든 오래된 txt/csv 는 CP949 인 경우가 많다.)
 */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

export function unescapeXml(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m])
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

export function rowsToText(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/\s*\n\s*/g, " ").trim()).join(" | ")).join("\n");
}
