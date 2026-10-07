import "server-only";
import { CLASSIFY_MODEL, getAnthropic } from "@/lib/chat/anthropic";
import { CERT_NAMES, hasCertName } from "@/lib/cert-names";
import { findSimilarFaq } from "./similar-faq";
import { DOC_FAQ_SYSTEM, DOC_FAQ_TOOL, buildDocFaqUserMessage } from "@/lib/prompts/doc-faq-extract";
import { QA_CLASSIFY_SYSTEM, buildQaClassifyUserMessage } from "@/lib/prompts/qa-pairs";
import type { FaqCategory } from "@/lib/db/types";
import type { DocFaqDeps, QaClassification, RawFaqItem, RawFaqKind } from "./doc-faq";

/** 추출 모델. 기본은 초안 작성 모델과 같다. */
const EXTRACT_MODEL = process.env.DRAFT_MODEL ?? process.env.ANSWER_MODEL ?? "claude-sonnet-5-5";
const certLabel = (slug: string) => (slug === "common" ? "공통(특정 인증 없음)" : hasCertName(slug) ? CERT_NAMES[slug] : slug);
const KINDS: RawFaqKind[] = ["igsc", "consulting", "other_authority"];
const CATEGORIES: FaqCategory[] = ["procedure", "cost", "duration", "document", "scope", "renewal"];

export const defaultDocFaqDeps: DocFaqDeps = {
  async extract(chunk, doc) {
    const res = await getAnthropic().messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 4096,
      system: DOC_FAQ_SYSTEM,
      tools: [DOC_FAQ_TOOL],
      // 이 모델은 tool_choice 강제(type: tool)를 지원하지 않는다: auto + 시스템 프롬프트로 도구 제출을 요구한다.
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: buildDocFaqUserMessage({ fileName: doc.file_name, certLabel: certLabel(doc.cert_type), page: chunk.page_no, sectionTitle: chunk.section_title, content: chunk.content }),
        },
      ],
    });
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return [];
    const faqs = (block.input as { faqs?: unknown }).faqs;
    if (!Array.isArray(faqs)) return [];
    const items: RawFaqItem[] = [];
    for (const f of faqs as Record<string, unknown>[]) {
      if (typeof f.question !== "string" || typeof f.answer !== "string") continue;
      items.push({
        question: f.question,
        variants: Array.isArray(f.variants) ? f.variants.filter((v): v is string => typeof v === "string") : [],
        answer: f.answer,
        category: CATEGORIES.includes(f.category as FaqCategory) ? (f.category as FaqCategory) : "scope",
        evidence: Array.isArray(f.evidence) ? f.evidence.filter((v): v is string => typeof v === "string") : [],
        kind: KINDS.includes(f.kind as RawFaqKind) ? (f.kind as RawFaqKind) : "igsc",
        reason: typeof f.reason === "string" ? f.reason : undefined,
      });
    }
    return items;
  },

  async classifyQa(pairs) {
    const res = await getAnthropic().messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: QA_CLASSIFY_SYSTEM,
      messages: [{ role: "user", content: buildQaClassifyUserMessage(pairs) }],
    });
    if (res.stop_reason !== "end_turn") throw new Error("분류 응답이 잘렸습니다.");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = /\[[\s\S]*\]/.exec(text);
    if (!m) throw new Error("분류 응답을 읽지 못했습니다.");
    const arr = JSON.parse(m[0]) as { n?: unknown; category?: unknown; consulting?: unknown }[];
    const out: QaClassification[] = pairs.map(() => ({ category: "scope", consulting: false }));
    for (const a of arr) {
      const i = typeof a.n === "number" ? a.n - 1 : -1;
      if (i < 0 || i >= pairs.length) continue;
      out[i] = { category: CATEGORIES.includes(a.category as FaqCategory) ? (a.category as FaqCategory) : "scope", consulting: a.consulting === true };
    }
    return out;
  },

  async isDuplicate(question, certType, justCreated) {
    // 같은 인증 종류의 approved + draft FAQ 와 이번 작업에서 방금 만든 질문을 비교한다 (findSimilarFaq).
    const extra = justCreated.map((q, i) => ({ id: `new-${i}`, question: q, status: "draft" as const, cert_type: certType }));
    const similar = await findSimilarFaq(question, certType, { extra });
    if (similar.length === 0) return { duplicate: false };
    const first = similar[0];
    return first.id.startsWith("new-") ? { duplicate: true, of: first.question } : { duplicate: true, of: first.question, id: first.id };
  },
};
