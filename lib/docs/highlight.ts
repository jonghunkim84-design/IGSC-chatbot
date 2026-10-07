/**
 * 원문(조각 텍스트) 안에서 근거(evidence) 문장이 있는 위치를 찾아 강조 구간으로 나눈다.
 * 근거 검증과 같은 기준(공백·줄바꿈 무시, 글자는 그대로)으로 찾으므로, 검증을 통과한 근거는 항상 찾아진다.
 */

export interface Segment {
  text: string;
  /** true 면 근거 문장(강조) */
  mark: boolean;
}

/** text 에서 quotes 각각이 나오는 구간(원문 인덱스 [start, end))을 겹침 없이 합쳐 돌려준다 */
export function findEvidenceRanges(text: string, quotes: string[]): [number, number][] {
  const flat: string[] = [];
  const map: number[] = []; // flat 인덱스 → 원문 인덱스
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    flat.push(text[i]);
    map.push(i);
  }
  const hay = flat.join("");

  const ranges: [number, number][] = [];
  for (const q of quotes) {
    const needle = q.replace(/\s+/g, "");
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      ranges.push([map[at], map[at + needle.length - 1] + 1]);
      from = at + needle.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export function highlightSegments(text: string, quotes: string[]): Segment[] {
  const ranges = findEvidenceRanges(text, quotes);
  if (ranges.length === 0) return [{ text, mark: false }];
  const out: Segment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: text.slice(pos, s), mark: false });
    out.push({ text: text.slice(s, e), mark: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out;
}
