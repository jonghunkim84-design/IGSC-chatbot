import { strFromU8, unzipSync } from "fflate";
import { readSheet } from "read-excel-file/node";
import { cleanText, decodeBytes, unescapeXml } from "./text";
import { ExtractError, type Block } from "./types";

type Cell = string | number | boolean | Date | null | undefined;

const fmt = (v: Cell): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return cleanText(String(v)).replace(/\s*\n\s*/g, " ");
};

const colName = (i: number) => `열${i + 1}`;

/**
 * 행 배열 → 블록. 첫 번째 비어 있지 않은 행을 헤더로 보고, 이후 각 행을 "헤더: 값 | 헤더: 값" 한 줄로 만든다.
 * (행 하나가 그 자체로 뜻이 통하도록 헤더를 행마다 붙인다.)
 */
export function rowsToBlocks(rows: Cell[][], sheetName: string | null): Block[] {
  const cleaned = rows.map((r) => r.map(fmt));
  const headerIdx = cleaned.findIndex((r) => r.some((c) => c));
  if (headerIdx < 0) return [];
  const header = cleaned[headerIdx];
  const lines: Block[] = [];
  for (const row of cleaned.slice(headerIdx + 1)) {
    const pairs = row.map((v, i) => (v ? `${header[i] || colName(i)}: ${v}` : "")).filter(Boolean);
    if (pairs.length) lines.push({ kind: "para", text: pairs.join(" | "), atomic: true });
  }
  if (lines.length === 0) return [];
  return sheetName ? [{ kind: "heading", text: sheetName, level: 1 }, ...lines] : lines;
}

/** xlsx 의 시트 이름을 순서대로 (workbook.xml) */
function sheetNames(bytes: Uint8Array): string[] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" });
  const xml = files["xl/workbook.xml"];
  if (!xml) throw new ExtractError("corrupt");
  return [...strFromU8(xml).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
}

export async function extractXlsx(bytes: Uint8Array): Promise<Block[]> {
  let names: string[];
  try {
    names = sheetNames(bytes);
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError("corrupt");
  }
  const blocks: Block[] = [];
  try {
    const buf = Buffer.from(bytes);
    for (const name of names) {
      const rows = (await readSheet(buf, name)) as Cell[][];
      blocks.push(...rowsToBlocks(rows, name));
    }
  } catch (e) {
    console.error("[extract] XLSX 읽기 오류:", (e as Error).message);
    throw new ExtractError("corrupt");
  }
  return blocks;
}

/** RFC 4180 CSV 파서 (따옴표, 따옴표 안의 쉼표·줄바꿈, "" 이스케이프) */
export function parseCsv(text: string): string[][] {
  // 구분자는 첫 줄에서 쉼표/탭/세미콜론 중 가장 많은 것
  const firstLine = text.split("\n", 1)[0] ?? "";
  const delim = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function extractCsv(bytes: Uint8Array): Block[] {
  return rowsToBlocks(parseCsv(decodeBytes(bytes)), null);
}
