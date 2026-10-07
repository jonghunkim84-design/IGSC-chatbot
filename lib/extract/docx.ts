import mammoth from "mammoth";
import { parse, type HTMLElement } from "node-html-parser";
import { cleanText } from "./text";
import { ExtractError, type Block } from "./types";

/** 제목 스타일을 h1~h6 으로 (영문/한글 스타일 이름 모두) */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='제목'] => h1:fresh",
  "p[style-name='제목 1'] => h1:fresh",
  "p[style-name='제목 2'] => h2:fresh",
  "p[style-name='제목 3'] => h3:fresh",
  "p[style-name='제목 4'] => h4:fresh",
];

const oneLine = (s: string) => cleanText(s).replace(/\s*\n\s*/g, " ");

function tableRows(table: HTMLElement): string[][] {
  return table
    .querySelectorAll("tr")
    .map((tr) => tr.querySelectorAll("th, td").map((c) => oneLine(c.text)))
    .filter((r) => r.some((c) => c.length > 0));
}

/** 본문 + 표. 제목 스타일은 heading 블록(→ section_title), 표는 통째로 하나의 table 블록. */
export async function extractDocx(bytes: Uint8Array): Promise<Block[]> {
  let html: string;
  try {
    const res = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, { styleMap: STYLE_MAP });
    html = res.value;
  } catch (e) {
    console.error("[extract] DOCX 변환 오류:", (e as Error).message);
    throw new ExtractError("corrupt");
  }

  const root = parse(html);
  const blocks: Block[] = [];
  for (const el of root.childNodes) {
    const node = el as HTMLElement;
    const tag = node.tagName?.toLowerCase();
    if (!tag) continue;
    if (/^h[1-6]$/.test(tag)) {
      const text = oneLine(node.text);
      if (text) blocks.push({ kind: "heading", text, level: Number(tag[1]) });
    } else if (tag === "table") {
      const rows = tableRows(node);
      if (rows.length) blocks.push({ kind: "table", rows });
    } else if (tag === "ul" || tag === "ol") {
      for (const li of node.querySelectorAll("li")) {
        const text = oneLine(li.text);
        if (text) blocks.push({ kind: "para", text: `• ${text}` });
      }
    } else {
      const text = cleanText(node.text);
      if (text) blocks.push({ kind: "para", text });
    }
  }
  return blocks;
}
