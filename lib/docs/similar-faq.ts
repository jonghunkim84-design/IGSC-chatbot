import "server-only";
import { CLASSIFY_MODEL, getAnthropic } from "@/lib/chat/anthropic";
import { certName } from "@/lib/cert-names";
import { listFaqQuestionsByCert } from "@/lib/db/admin-doc-faq";
import { SIMILAR_FAQ_SYSTEM, SIMILAR_MAX, buildSimilarListBlock, buildSimilarUserMessage } from "@/lib/prompts/similar-faq";
import { parseSelection } from "@/lib/search/select-faq";
import { norm } from "@/lib/ingest/evidence";

export interface SimilarFaq {
  id: string;
  question: string;
  status: "draft" | "approved";
  cert_type: string;
}

export interface SimilarDeps {
  /** 비교 대상: approved + draft 질문. certType 이 있으면 그 인증 종류만. */
  listFaqs: (certType?: string) => Promise<SimilarFaq[]>;
  /** 목록에서 의미가 같은 항목의 0-based 인덱스를 고른다 */
  select: (question: string, list: SimilarFaq[], certType?: string) => Promise<number[]>;
}

export const defaultSimilarDeps: SimilarDeps = {
  listFaqs: listFaqQuestionsByCert,
  async select(question, list, certType) {
    const res = await getAnthropic().messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 60,
      temperature: 0,
      system: [
        { type: "text", text: SIMILAR_FAQ_SYSTEM },
        { type: "text", text: buildSimilarListBlock(list.map((f) => ({ cert: certName(f.cert_type), question: f.question }))), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: buildSimilarUserMessage(question, certType ? certName(certType) : null) }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return parseSelection(text, list.length).map((n) => n - 1);
  },
};

/**
 * 같은 인증 종류의 approved + draft FAQ 중 의미가 같은 질문을 찾는다.
 *  - certType 이 있으면 그 인증 종류의 FAQ 만 비교한다. 같은 질문이라도 인증 종류가 다르면 유사한 것으로 보지 않는다
 *    (식품 비건과 화장품 비건은 별개). certType 이 없으면 전체를 비교하되 판정 기준은 같다(인증 종류가 다르면 제외).
 *  - 완전히 같은 질문(공백·대소문자 무시)은 모델 호출 없이 먼저 찾는다.
 *  - excludeId: 수정 중인 FAQ 자신은 제외한다.
 *  - extra: 아직 DB 에 저장되지 않은 후보들(같은 작업에서 방금 만든 질문 등)과도 비교한다.
 */
export async function findSimilarFaq(
  question: string,
  certType?: string,
  opts: { excludeId?: string; extra?: SimilarFaq[] } = {},
  deps: SimilarDeps = defaultSimilarDeps,
): Promise<SimilarFaq[]> {
  const q = question.trim();
  if (!q) return [];
  const all = [...(await deps.listFaqs(certType)), ...(opts.extra ?? [])].filter((f) => f.id !== opts.excludeId && (!certType || f.cert_type === certType));
  if (all.length === 0) return [];

  const found: SimilarFaq[] = [];
  const add = (f: SimilarFaq | undefined) => {
    if (f && !found.some((x) => x.id === f.id)) found.push(f);
  };
  for (const f of all) if (norm(f.question).toLowerCase() === norm(q).toLowerCase()) add(f);
  if (found.length >= SIMILAR_MAX) return found.slice(0, SIMILAR_MAX);

  for (const i of await deps.select(q, all, certType)) add(all[i]);
  return found.slice(0, SIMILAR_MAX);
}
