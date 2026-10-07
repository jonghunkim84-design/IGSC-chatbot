import "server-only";
import { getAnthropic, CLASSIFY_MODEL } from "@/lib/chat/anthropic";
import { classifyQuestion } from "@/lib/chat/classify";
import { CERT_NAMES, hasCertName } from "@/lib/cert-names";
import { DOC_CATEGORY_LABELS } from "@/lib/admin/labels";
import { listCandidateDocs, loadDocChunks } from "@/lib/db/admin-doc-search";
import {
  CONSULT_SCREEN_SYSTEM,
  buildConsultScreenUserMessage,
  DOC_PICK_SYSTEM,
  DRAFT_SYSTEM,
  DRAFT_TOOL,
  DRAFT_TOOL_NAME,
  buildDocListBlock,
  buildDocPickUserMessage,
  buildDraftUserMessage,
} from "@/lib/prompts/doc-draft";
import { parseSelection } from "@/lib/search/select-faq";
import type { FaqCategory } from "@/lib/db/types";
import { draftFromDocs, type Draft, type DraftDeps, type DraftOutcome, type DocInfo, type LabeledChunk, type RawDraft } from "./draft";

/** 초안 작성 모델. 기본은 답변 모델과 같다. */
const DRAFT_MODEL = process.env.DRAFT_MODEL ?? process.env.ANSWER_MODEL ?? "claude-sonnet-5-5";
const CATEGORIES: FaqCategory[] = ["procedure", "cost", "duration", "document", "scope", "renewal"];
const certLabel = (slug: string) => (slug === "common" ? "공통" : hasCertName(slug) ? CERT_NAMES[slug] : slug);

async function selectDocs(question: string, docs: DocInfo[]): Promise<string[]> {
  const res = await getAnthropic().messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 50,
    temperature: 0,
    system: [
      { type: "text", text: DOC_PICK_SYSTEM },
      {
        type: "text",
        text: buildDocListBlock(
          docs.map((d) => ({ file_name: d.file_name, cert_label: certLabel(d.cert_type), category_label: DOC_CATEGORY_LABELS[d.doc_category] ?? d.doc_category, sections: d.sections, preview: d.preview })),
        ),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildDocPickUserMessage(question) }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return parseSelection(text, docs.length).map((n) => docs[n - 1].id);
}

async function generate(question: string, chunks: LabeledChunk[], weakSentences: string[] = []): Promise<RawDraft> {
  const res = await getAnthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: 4096,
    system: DRAFT_SYSTEM,
    tools: [DRAFT_TOOL],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: buildDraftUserMessage(
          question,
          chunks.map((c) => ({ label: c.label, file_name: c.file_name, page_no: c.page_no, section_title: c.section_title, content: c.content })),
          weakSentences,
        ),
      },
    ],
  });
  console.info("[doc-draft] 토큰 사용", { input: res.usage.input_tokens, output: res.usage.output_tokens, chunks: chunks.length });
  // 출력이 길어 잘리면 evidence 가 빠진 채로 오므로 원인을 로그로 남긴다
  if (res.stop_reason === "max_tokens") console.warn("[doc-draft] 초안 응답이 최대 길이에서 잘렸습니다", { output: res.usage.output_tokens });
  const block = res.content.find((b) => b.type === "tool_use" && b.name === DRAFT_TOOL_NAME);
  if (!block || block.type !== "tool_use") throw new Error("초안 도구 응답이 없습니다.");
  const i = block.input as Partial<RawDraft>;
  const category = CATEGORIES.includes(i.category as FaqCategory) ? (i.category as FaqCategory) : "scope";
  return {
    found: i.found === true,
    answer: typeof i.answer === "string" ? i.answer : "",
    category,
    confidence: i.confidence === "high" || i.confidence === "low" ? i.confidence : "medium",
    evidence: Array.isArray(i.evidence) ? i.evidence.filter((e) => e && typeof e.chunk === "string" && typeof e.quote === "string") : [],
  };
}

/** 질문 분류(챗봇과 같은 분류기): allowed 만 초안 대상 */
async function screenQuestion(question: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const c = await classifyQuestion(question);
  if (c.label === "allowed") return { ok: true };
  const reasons = {
    consulting: "컨설팅 요청이라 초안을 만들지 않았습니다. 인증기관은 컨설팅을 제공할 수 없습니다(ISO 17065 공평성).",
    complaint: "불만·이의제기는 FAQ가 아니라 담당자가 직접 처리하는 건이라 초안을 만들지 않았습니다.",
    out_of_scope: "인증과 관련 없는 질문이라 초안을 만들지 않았습니다.",
  } as const;
  return { ok: false, reason: reasons[c.label] };
}

/** 초안 답변에 컨설팅성 조언이 있는가 (오류 시 예외 → 초안을 만들지 않는다: 안전한 쪽으로 실패) */
async function screenAnswer(answer: string): Promise<boolean> {
  const res = await getAnthropic().messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 30,
    temperature: 0,
    system: CONSULT_SCREEN_SYSTEM,
    messages: [{ role: "user", content: buildConsultScreenUserMessage(answer) }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`컨설팅 점검 응답 형식 오류: ${text.slice(0, 60)}`);
  return (JSON.parse(m[0]) as { consulting?: unknown }).consulting === true;
}

export const defaultDraftDeps: DraftDeps = {
  loadDocs: () => listCandidateDocs(),
  loadChunks: loadDocChunks,
  selectDocs,
  generate,
  screenQuestion,
  screenAnswer,
};

/**
 * 질문에 대해 업로드 문서에서 근거를 찾아 답변 초안을 만든다.
 * 근거를 못 찾았거나 코드 검증(evidence·숫자·문장 근거)에 걸리면 null.
 */
export async function draftAnswerFromDocs(question: string, certType?: string): Promise<Draft | null> {
  const out = await draftFromDocs(question, certType, defaultDraftDeps);
  return out.status === "drafted" ? out.draft : null;
}

export type { DraftOutcome };
