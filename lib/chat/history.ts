import {
  SELECT_HISTORY_SYSTEM,
  buildHistoryListBlock,
  buildSelectUserMessage,
} from "@/lib/prompts/select";
import { parseSelection } from "@/lib/search/select-faq";
import { certName } from "@/lib/cert-names";
import type { CertHistory } from "@/lib/db/types";
import { CLASSIFY_MODEL, getAnthropic } from "./anthropic";

/** 고객이 문의한 제품과 유사한 인증 이력을 최대 3건 고른다 (없으면 []). */
export async function selectSimilarHistory(query: string, rows: CertHistory[]): Promise<CertHistory[]> {
  if (rows.length === 0) return [];
  const res = await getAnthropic().messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 50,
    temperature: 0,
    system: [
      { type: "text", text: SELECT_HISTORY_SYSTEM },
      { type: "text", text: buildHistoryListBlock(rows), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildSelectUserMessage(query) }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return parseSelection(text, rows.length).map((n) => rows[n - 1]);
}

/** 이력 안내 문구는 모델이 아니라 DB 값으로 조립한다 (환각 방지). */
export function formatHistoryLine(h: CertHistory): string {
  const parts = [certName(h.cert_type), h.product_category].filter(Boolean).join(" / ");
  const who = h.company_public && h.company_name ? ` · ${h.company_name}` : "";
  const year = h.year ? ` · ${h.year}년` : "";
  return `- ${parts}${who}${year}`;
}

/** 업체명이 없으면 서로 다른 이력이 같은 문구가 되므로, 똑같은 줄은 하나로 합친다. */
export function formatHistoryLines(rows: CertHistory[]): string[] {
  return [...new Set(rows.map(formatHistoryLine))];
}
