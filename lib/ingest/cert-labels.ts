/**
 * cert_type slug → 한글 인증명 매핑.
 * 크롤링한 원문의 페이지 제목("대분류 / 이름")에서 이름 부분을 가져온다.
 * 한 slug에 제목이 여러 개면: 한글이 포함된 이름 우선 → 가장 많이 쓰인 이름.
 */

export interface LabelSource {
  cert_type: string;
  source_urls: string[];
  needs_input: boolean;
}

export interface LabelResult {
  labels: Map<string, string>;
  /** 원문 제목에서 이름을 찾지 못한 slug */
  unmapped: string[];
  /** 후보 이름이 둘 이상이라 하나를 고른 slug */
  ambiguous: { slug: string; chosen: string; candidates: string[] }[];
  /** 선택된 이름에 한글이 없는 slug (원문 제목이 영문뿐) */
  englishOnly: { slug: string; label: string }[];
}

const HANGUL = /[가-힣]/;

/** "식품 / 비건(Vegan)" → "비건(Vegan)", "환경 및 건강 / 환경성적표지(EPD)" → "환경성적표지(EPD)" */
export function nameFromTitle(title: string): string | null {
  const parts = title.split(" / ").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts.slice(1).join(" / ");
  // "EPD China / EPD China" 처럼 대분류와 이름이 같은 제목도 이름으로 인정
  return name || null;
}

export function buildCertLabels(
  items: LabelSource[],
  titleByUrl: Map<string, string>,
): LabelResult {
  const freq = new Map<string, Map<string, number>>();
  for (const it of items) {
    if (it.needs_input || it.cert_type === "common") continue;
    for (const url of it.source_urls) {
      const name = nameFromTitle(titleByUrl.get(url) ?? "");
      if (!name) continue;
      const m = freq.get(it.cert_type) ?? new Map<string, number>();
      m.set(name, (m.get(name) ?? 0) + 1);
      freq.set(it.cert_type, m);
    }
  }

  const labels = new Map<string, string>();
  const ambiguous: LabelResult["ambiguous"] = [];
  const englishOnly: LabelResult["englishOnly"] = [];
  for (const [slug, m] of freq) {
    const cands = [...m.entries()].sort(
      (a, b) => Number(HANGUL.test(b[0])) - Number(HANGUL.test(a[0])) || b[1] - a[1],
    );
    const chosen = cands[0][0];
    labels.set(slug, chosen);
    if (cands.length > 1) ambiguous.push({ slug, chosen, candidates: cands.map((c) => c[0]) });
    if (!HANGUL.test(chosen)) englishOnly.push({ slug, label: chosen });
  }

  const allSlugs = [...new Set(items.map((i) => i.cert_type))].filter((s) => s !== "common");
  const unmapped = allSlugs.filter((s) => !labels.has(s));
  return { labels, unmapped, ambiguous, englishOnly };
}

/** 비용·기간 placeholder 문구. label이 없으면 일반 문구. */
export function placeholderText(label: string | undefined, category: "cost" | "duration") {
  const base = label ? `${label} 인증` : "인증";
  return category === "cost"
    ? { question: `${base} 비용은 얼마인가요?`, variants: [`${base} 수수료`, `${base} 견적`] }
    : {
        question: `${base} 심사 기간은 얼마나 걸리나요?`,
        variants: [`${base} 소요 기간`, `${base} 발급까지 얼마나 걸리나요`],
      };
}
