export interface CsvFaq {
  id: string;
  cert_type: string;
  category: string;
  needs_input: boolean;
  question: string;
  variants: string[];
  answer: string;
  source_url: string;
  evidence: string[];
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** 검수용 CSV. 앞의 BOM은 Excel 한글 깨짐 방지. */
export function toCsv(items: CsvFaq[]): string {
  const head = ["id", "cert_type", "category", "needs_input", "question", "variants", "answer", "source_url", "evidence"];
  const rows = items.map((i) =>
    [
      i.id, i.cert_type, i.category, String(i.needs_input), i.question, i.variants.join(" | "),
      i.answer, i.source_url, i.evidence.join(" ⏎ "),
    ].map(csvCell).join(","),
  );
  return "\uFEFF" + [head.join(","), ...rows].join("\r\n") + "\r\n";
}
