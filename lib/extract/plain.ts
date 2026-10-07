import { cleanText, decodeBytes } from "./text";
import type { Block } from "./types";

/** txt: 빈 줄 기준 문단 그대로 */
export function extractTxt(bytes: Uint8Array): Block[] {
  return cleanText(decodeBytes(bytes))
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ kind: "para", text }) as Block);
}

const MD_TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** md: 제목(#), 표(|), 코드 블록은 그대로 하나의 문단으로, 나머지는 빈 줄 기준 문단 */
export function extractMd(bytes: Uint8Array): Block[] {
  const lines = cleanText(decodeBytes(bytes)).split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  const flushPara = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ kind: "para", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const code = [line];
      while (++i < lines.length) {
        code.push(lines[i]);
        if (/^\s*```/.test(lines[i])) break;
      }
      blocks.push({ kind: "para", text: code.join("\n"), atomic: true });
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ kind: "heading", text: h[2], level: h[1].length });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushPara();
      const tableLines = [line];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) tableLines.push(lines[++i]);
      const rows = tableLines
        .filter((l) => !MD_TABLE_SEP.test(l.trim()))
        .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      if (rows.length) blocks.push({ kind: "table", rows });
      continue;
    }
    if (!line.trim()) flushPara();
    else buf.push(line);
  }
  flushPara();
  return blocks;
}
