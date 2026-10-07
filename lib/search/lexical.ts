import { norm } from "@/lib/ingest/evidence";

/** 어휘 일치 최소 길이(공백 제거 후)와, 질문 전체에서 일치한 FAQ 표현이 차지해야 하는 비율 */
const MIN_CHARS = 8;
const MIN_COVERAGE = 0.6;
const MAX_BOOST = 3;

const clean = (s: string) => norm(s).replace(/[?？!！.,~·"'“”‘’()（）\[\]]/g, "").toLowerCase();

export interface LexicalItem {
  id: string;
  question: string;
  variants: string[];
}

/**
 * 고객 질문이 FAQ 의 질문 또는 '다른 표현(variants)'과 사실상 같은 경우를 코드로 먼저 찾는다.
 * 목록이 수백 건이면 모델이 정확히 같은 표현의 항목도 놓칠 수 있어서(특히 목록 끝쪽), 이 경우를 모델에 맡기지 않는다.
 *  - FAQ 표현(질문·다른 표현)이 8자 이상이고, 고객 질문(또는 반대로 고객 질문이 FAQ 표현)에 통째로 들어 있으며,
 *    그 표현이 질문 전체의 60% 이상을 차지할 때만 일치로 본다 ("귀사는 ~ 알려주세요"처럼 앞뒤에 말이 조금 붙는 정도까지).
 *  - 일치 정도(차지하는 비율)가 큰 순서로 최대 3개를 돌려준다.
 */
export function lexicalMatches(query: string, list: LexicalItem[]): string[] {
  const q = clean(query);
  if (q.length < MIN_CHARS) return [];
  const scored: { id: string; score: number }[] = [];
  for (const f of list) {
    let best = 0;
    for (const phrase of [f.question, ...f.variants]) {
      const p = clean(phrase);
      if (p.length < MIN_CHARS) continue;
      if (q.includes(p)) best = Math.max(best, p.length / q.length);
      else if (p.includes(q)) best = Math.max(best, q.length / p.length);
    }
    if (best >= MIN_COVERAGE) scored.push({ id: f.id, score: best });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_BOOST).map((s) => s.id);
}
