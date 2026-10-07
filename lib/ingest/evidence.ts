/**
 * 근거(evidence) 검증 — 환각을 막는 안전판.
 * Phase 2(원문 → FAQ 초안)와 Phase 10(업로드 문서 → 초안 답변)이 같은 코드를 쓴다.
 */

/** 공백을 모두 뺀 비교용 문자열 (줄바꿈·띄어쓰기 차이를 무시하고 글자 그대로인지 본다) */
export const norm = (s: string) => s.replace(/\s+/g, "");

/** 숫자 토큰: 천 단위 쉼표를 뺀 정수/소수 (3,000,000 → 3000000, 12.5 → 12.5) */
export function numberTokens(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, ""));
}

/** 목록 번호("1) ", "2. ")는 내용이 아니라 형식이라 숫자 검사에서 제외한다 */
const stripListMarkers = (s: string) => s.replace(/(^|\n)\s*\(?\d{1,2}[.)]\s+/g, "$1");

export interface EvidenceItem {
  answer: string;
  evidence: string[];
}

/**
 * 답변 + 근거 검증. 통과하면 null, 실패하면 사유(한국어).
 *  1. 답변이 비어 있지 않을 것
 *  2. evidence 가 있고, 각 evidence 가 source 원문에 글자 그대로(공백 무시) 존재할 것
 *  3. 답변에 든 숫자가 source 에 있을 것
 *     - 기본(Phase 2): 원문에 그 숫자 문자열이 포함되어 있으면 통과
 *     - strictNumbers(Phase 10): 원문의 숫자 토큰과 정확히 같아야 통과 (예: "300만원" 의 300 은 원문 "3,000,000" 과 다르므로 실패).
 *       단위 환산·어림을 통한 숫자 변조를 막는다.
 */
export function validateEvidence(item: EvidenceItem, source: string, opts: { strictNumbers?: boolean } = {}): string | null {
  const src = norm(source);
  if (!item.answer.trim()) return "빈 답변";
  if (!item.evidence?.length) return "evidence 없음";
  for (const e of item.evidence) {
    if (!norm(e) || !src.includes(norm(e))) return `evidence가 원문에 없음: "${e.slice(0, 40)}…"`;
  }
  if (opts.strictNumbers) {
    const known = new Set(numberTokens(source));
    for (const n of numberTokens(stripListMarkers(item.answer))) {
      if (!known.has(n)) return `답변의 숫자 "${n}"가 원문에 없음`;
    }
  } else {
    for (const num of item.answer.match(/\d[\d,.]*/g) ?? []) {
      const n = num.replace(/[.,]+$/, "");
      if (!src.includes(n)) return `답변의 숫자 "${n}"가 원문에 없음`;
    }
  }
  return null;
}

// ── 문장 근거 확인 (어휘 겹침) ─────────────────────────────────────────
// evidence 와 숫자가 맞아도, 답변에 근거 없는 문장이 섞일 수 있다. 각 문장의 글자쌍(bigram)이 근거 문장들에 얼마나 들어 있는지 본다.

export function bigramSet(s: string): Set<string> {
  const chars = [...s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")];
  const out = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => [...s.replace(/[^\p{L}\p{N}]/gu, "")].length >= 8);
}

// 핵심 단어(조사·어미를 뗀 단어)가 근거 문장에 그대로 있는지를 본다.
// 조사가 바뀐 정상 문장("검토는" → "검토에는")도 통과하고, 근거에 없는 내용의 문장은 걸러진다.
// 측정값: 정상 문장 0.56~1.00, 근거 없는 문장 0.00~0.29 (글자쌍 방식은 0.42 vs 0.29 로 간격이 좁았다).
const PARTICLES = /(에서는|으로는|에게는|입니다|합니다|됩니다|습니다|에서|으로|에는|에게|까지|부터|이며|이고|하며|한다|된다|은|는|이|가|을|를|의|에|와|과|로|도|만|며|고|다)$/;

export function contentStems(sentence: string): string[] {
  return sentence
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => {
      const stem = w.replace(PARTICLES, "");
      return [...stem].length >= 2 ? stem : w;
    })
    .filter((w) => [...w].length >= 2 || /\d/.test(w));
}

/** 문장 하나가 근거 텍스트에 뒷받침되는 비율 (0~1): 핵심 단어 중 근거에 그대로 나오는 비율 */
export function sentenceSupport(sentence: string, evidenceText: string): number {
  const stems = contentStems(sentence);
  if (stems.length === 0) return 1;
  const ev = norm(evidenceText).toLowerCase();
  return stems.filter((w) => ev.includes(w.toLowerCase())).length / stems.length;
}

/** 근거가 부족한 문장 목록 (threshold 미만) */
export function weaklySupportedSentences(answer: string, evidence: string[], threshold = 0.45): { sentence: string; score: number }[] {
  const ev = evidence.join("\n");
  return splitSentences(answer)
    .map((sentence) => ({ sentence, score: sentenceSupport(sentence, ev) }))
    .filter((x) => x.score < threshold);
}
