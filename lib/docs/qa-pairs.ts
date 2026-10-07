/**
 * 질문·답변이 이미 정리된 문서(doc_format='qa_pairs')에서 질문·답변 쌍을 그대로 꺼낸다. AI 를 쓰지 않는다.
 *  - 질문은 원문의 질문, 답변은 원문의 답변 그대로 (요약·재작성 없음). 질문 앞의 번호 표기("Q 1." 등)만 뗀다.
 *  - 인식하는 형식
 *      1) 2열 표: 왼쪽 칸이 질문, 오른쪽 칸이 답변 (DOCX 표). 첫 행이 "질문 | 답변" 같은 머리글이면 건너뛴다.
 *      2) 스프레드시트·CSV 두 열: 추출기가 만든 "머리글: 값 | 머리글: 값" 한 줄
 *      3) "Q:" / "A:" (또는 "Q." "Q1)" "질문:" "답변:") 표기. 질문이 여러 줄이어도 "A:" 전까지는 질문이다.
 *      4) "Q 1." 같은 질문 머리글만 있고 답변 표시는 없는 형식: 답변은 다음 질문 머리글 전까지의 문단들
 *  - 질문 머리글: 줄 맨 앞의 Q / 질문 + (번호) + 마침표·콜론·괄호. 답변 표시: A / 답변 / 답 + (번호) + 마침표·콜론·괄호.
 */
import type { Block } from "@/lib/extract/types";

export interface QaPair {
  question: string;
  answer: string;
  /** 표가 아닌 텍스트에서 읽었으면 그 쪽(PDF·슬라이드). 없으면 null */
  page: number | null;
}

const Q_START = /^\s*(?:Q|질문)\s*\d*\s*[.:)\]]\s*(.*)$/i;
const A_START = /^\s*(?:A|답변|답)\s*\d*\s*[.:)\]]\s*(.*)$/i;
const HEADER_Q = /^(?:질문|문의|문의내용|question|q)\s*$/i;
const HEADER_A = /^(?:답변|답|응답|answer|a)\s*$/i;
/** 스프레드시트 추출 행("머리글: 값 | 머리글: 값 …")처럼 보이는 줄: 2열이 아니면 질문·답변 쌍으로 읽지 않는다 */
const SHEET_ROW = /^[^:|]{1,30}: [\s\S]+ \| [^:|]{1,30}: /;
const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();

/** 한 줄에서 "머리글: 값 | 머리글: 값" 두 칸을 읽는다 (스프레드시트·CSV 추출 결과) */
function twoColumnLine(line: string): [string, string] | null {
  const m = /^([^:|]{1,30}): ([\s\S]+?) \| ([^:|]{1,30}): ([\s\S]+)$/.exec(line);
  if (!m) return null;
  if (/ \| [^:|]{1,30}: /.test(m[4])) return null; // 세 번째 이후 열이 더 있으면 2열 표가 아니다
  return [clean(m[2]), clean(m[4])];
}

interface Cur {
  q: string[];
  /** 답변 표시(A:) 전에 나온 줄들: 표시가 나오면 질문의 연속, 끝까지 표시가 없으면 답변 */
  pre: string[];
  a: string[];
  inA: boolean;
  page: number | null;
}

/** 블록 배열(추출기 결과)에서 질문·답변 쌍을 문서 순서대로 꺼낸다. */
export function parseQaPairs(blocks: Block[]): QaPair[] {
  const pairs: QaPair[] = [];
  let cur: Cur | null = null;
  const flush = () => {
    if (!cur) return;
    const question = clean(cur.q.join(" "));
    const answer = (cur.inA ? cur.a : cur.pre).join("\n").trim();
    if (question) pairs.push({ question, answer, page: cur.page });
    cur = null;
  };

  for (const b of blocks) {
    if (b.kind === "table") {
      flush();
      const rows = b.rows.map((r) => r.filter((c) => c.trim())).filter((r) => r.length > 0);
      if (rows.length === 0 || rows.some((r) => r.length !== 2)) continue; // 2열 표만
      const start = HEADER_Q.test(clean(rows[0][0])) && HEADER_A.test(clean(rows[0][1])) ? 1 : 0;
      for (const [q, a] of rows.slice(start)) if (clean(q)) pairs.push({ question: clean(q), answer: a.trim(), page: null });
      continue;
    }
    if (b.kind === "heading" && !Q_START.test(b.text)) continue; // 질문 머리글이 아닌 제목(절 이름 등)은 건너뛴다

    for (const raw of b.text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (b.kind === "para") {
        const two = twoColumnLine(line);
        if (two) {
          flush();
          pairs.push({ question: two[0], answer: two[1], page: b.page ?? null });
          continue;
        }
        if (SHEET_ROW.test(line)) continue;
      }
      const q = Q_START.exec(line);
      if (q) {
        flush();
        cur = { q: [q[1]], pre: [], a: [], inA: false, page: b.page ?? null };
        continue;
      }
      if (!cur) continue;
      const a = A_START.exec(line);
      if (a && !cur.inA) {
        cur.inA = true;
        cur.q.push(...cur.pre); // 표시 전 줄은 질문의 연속이었다
        cur.pre = [];
        if (a[1]) cur.a.push(a[1]);
      } else if (cur.inA) cur.a.push(line);
      else cur.pre.push(line);
    }
  }
  flush();
  return pairs;
}
