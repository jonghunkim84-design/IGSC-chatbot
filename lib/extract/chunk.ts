import { rowsToText } from "./text";
import type { Block, Chunk } from "./types";

/**
 * 조각 나누기 규칙
 *  - 문단 경계 기준으로 800~1200자를 목표로 묶는다.
 *  - 이어지는 조각은 앞 조각의 끝 100자를 겹쳐서 시작한다 (한 흐름의 문단 안에서만).
 *  - 제목·페이지(슬라이드)·표가 바뀌는 곳에서는 조각을 끊는다. 그래서 조각은 페이지를 넘지 않고, 하나의 section_title 만 가진다.
 *    (그 결과 짧은 절/페이지의 조각은 800자보다 짧을 수 있다.)
 *  - 표는 쪼개지 않는다. 1200자를 넘어도 6000자까지는 표 하나를 한 조각으로 둔다.
 *    그보다 큰 표만 행 단위로 나누고, 나뉜 조각마다 머리글 행을 반복한다.
 */
export const CHUNK_MIN = 800;
export const CHUNK_MAX = 1200;
export const CHUNK_OVERLAP = 100;
export const TABLE_MAX = 6000;

const SEP = "\n\n";

/** 앞 조각의 끝 100자 (단어 중간에서 시작하지 않도록 첫 공백 이후부터) */
export function overlapTail(text: string, size = CHUNK_OVERLAP): string {
  if (text.length <= size) return text;
  const tail = text.slice(-size);
  const sp = tail.search(/\s/);
  return (sp > -1 && sp < 30 ? tail.slice(sp + 1) : tail).trim();
}

const SENTENCE_END = /(?:[.!?。！？]|다\.|요\.|니다\.)["')\]”’]?\s|\n/g;

/** 1200자를 넘는 문단을 문장 경계에서 나눈다 (조각 사이 100자 중첩 포함) */
export function splitLongText(text: string, max = CHUNK_MAX, overlap = CHUNK_OVERLAP): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      let cut = -1;
      for (const m of window.matchAll(SENTENCE_END)) {
        if (m.index! + m[0].length >= CHUNK_MIN) cut = m.index! + m[0].length;
      }
      if (cut < 0) {
        const lastSpace = window.lastIndexOf(" ");
        cut = lastSpace >= CHUNK_MIN ? lastSpace + 1 : window.length;
      }
      end = start + cut;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    // 다음 조각은 100자 앞에서 시작 (단어 중간이면 공백 뒤로)
    let next = Math.max(end - overlap, start + 1);
    const sp = text.slice(next, end).search(/\s/);
    if (sp > -1 && sp < 30) next += sp + 1;
    start = next;
  }
  return out.filter(Boolean);
}

/** 큰 표를 행 단위로 나누고 조각마다 머리글 행을 반복한다 */
function splitTable(rows: string[][]): string[] {
  const header = rows[0] ? rowsToText([rows[0]]) : "";
  const body = rows.slice(1).map((r) => rowsToText([r]));
  const pieces: string[] = [];
  let cur: string[] = [];
  let len = header.length;
  for (const line of body) {
    if (cur.length && len + line.length + 1 > CHUNK_MAX * 2) {
      pieces.push([header, ...cur].join("\n"));
      cur = [];
      len = header.length;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) pieces.push([header, ...cur].join("\n"));
  return pieces;
}

export function chunkBlocks(blocks: Block[]): Chunk[] {
  const chunks: Chunk[] = [];
  let parts: string[] = [];
  let len = 0;
  let page: number | null = null;
  let section: string | null = null;
  let overlapNext = ""; // 크기 때문에 끊긴 문단 흐름의 다음 조각 앞에 붙일 겹침 텍스트

  const push = (content: string, pg: number | null, sec: string | null) => {
    const c = content.trim();
    if (c) chunks.push({ chunk_index: chunks.length, content: c, page_no: pg, section_title: sec });
  };
  /** reason: 'size' 면 이어지는 문단 흐름이라 다음 조각에 겹침을 붙인다 */
  const flush = (reason: "size" | "boundary") => {
    if (parts.length === 0) return;
    const content = parts.join(SEP);
    push(content, page, section);
    overlapNext = reason === "size" ? overlapTail(content) : "";
    parts = [];
    len = 0;
  };
  const append = (text: string) => {
    parts.push(text);
    len += (parts.length > 1 ? SEP.length : 0) + text.length;
  };
  const startWith = (text: string, useOverlap: boolean) => {
    if (useOverlap && overlapNext) {
      const first = `${overlapNext}\n${text}`;
      append(first);
    } else {
      append(text);
    }
    overlapNext = "";
  };

  for (const b of blocks) {
    const pg = b.page ?? null;
    if (pg !== page && (parts.length > 0 || chunks.length > 0)) {
      flush("boundary");
      overlapNext = "";
    }
    page = pg;

    if (b.kind === "heading") {
      flush("boundary");
      overlapNext = "";
      section = b.text;
      append(b.text);
      continue;
    }

    if (b.kind === "table") {
      const text = rowsToText(b.rows);
      if (!text.trim()) continue;
      overlapNext = "";
      if (text.length <= CHUNK_MAX) {
        if (len > 0 && len + SEP.length + text.length > CHUNK_MAX) flush("boundary");
        append(text);
      } else {
        flush("boundary");
        if (text.length <= TABLE_MAX) {
          push(text, page, section);
        } else {
          for (const piece of splitTable(b.rows)) push(piece, page, section);
        }
      }
      continue;
    }

    // 문단
    let text = b.text.trim();
    if (!text) continue;
    if (text.length > CHUNK_MAX && !b.atomic) {
      // 긴 문단: 문장 경계로 나눈다. 앞에 제목/짧은 문단만 있으면 첫 조각에 함께 넣어 제목만 따로 남지 않게 하고,
      // 마지막 조각은 뒤 문단과 합쳐질 수 있게 열어 둔다.
      if (len > 0 && len < CHUNK_MIN) {
        text = `${parts.join(SEP)}${SEP}${text}`;
        parts = [];
        len = 0;
      } else {
        flush("boundary");
      }
      const pieces = splitLongText(text);
      pieces.slice(0, -1).forEach((p) => push(p, page, section));
      overlapNext = "";
      append(pieces[pieces.length - 1]);
      continue;
    }
    if (len > 0 && len + SEP.length + text.length > CHUNK_MAX) flush(b.atomic ? "boundary" : "size");
    if (parts.length === 0) startWith(text, !b.atomic);
    else append(text);
  }
  flush("boundary");
  return chunks;
}
