/**
 * 문서 단위 FAQ 일괄 초안(Phase 12) 핵심 로직. DB·Claude 접근은 deps 로 주입한다 (테스트 가능).
 *
 * 청크 → Q&A 추출(Claude) → 거름망 → 저장 대상 목록:
 *   a) evidence 가 청크 원문에 글자 그대로 있어야 한다
 *   b) 답변의 숫자가 원문 숫자와 정확히 같아야 한다 (strictNumbers)
 *   c) 컨설팅성 내용 탈락 (모델 판정 kind=consulting + 질문 표현 점검)
 *   d) IGSC 소관이 아닌 타 기관·법정 제도 안내 탈락 (kind=other_authority)
 *   e) 기존 FAQ(승인·초안 모두) 또는 이번 작업에서 방금 만든 항목과 중복이면 탈락
 * 탈락 항목은 사유·단계·원문 일부와 함께 돌려준다. 통과 항목은 항상 status='draft' 로 저장된다.
 */
import { norm, validateEvidence } from "@/lib/ingest/evidence";
import type { DocFaqRejected, DocCategoryType, DocFormat, DocStatus, FaqCategory } from "@/lib/db/types";
import { MAX_DRAFTS_PER_DOCUMENT, MAX_FAQ_PER_CHUNK } from "@/lib/ingest/config";
import type { QaPair } from "./qa-pairs";

/** 이 문서 일괄 초안임을 표시하는 메모 접두어. 재실행 때 교체 대상을 가려내는 데 쓴다. */
export const AUTO_NOTE_PREFIX = "[문서 일괄 초안]";

export interface DocFaqDoc {
  id: string;
  file_name: string;
  cert_type: string;
  doc_category: DocCategoryType;
  status: DocStatus;
  doc_format?: DocFormat;
}

export interface FaqChunk {
  page_no: number | null;
  section_title: string | null;
  content: string;
}

export type RawFaqKind = "igsc" | "consulting" | "other_authority";

export interface RawFaqItem {
  question: string;
  variants: string[];
  answer: string;
  category: FaqCategory;
  evidence: string[];
  kind: RawFaqKind;
  reason?: string;
}

export interface DocFaqDraft {
  question: string;
  variants: string[];
  answer: string;
  category: FaqCategory;
  cert_type: string;
  source_doc_id: string;
  source_page: number | null;
  source_evidence: string[];
  needs_input: boolean;
  draft_note: string;
}

export interface ExistingQuestion {
  id?: string;
  cert_type: string;
  question: string;
}

export interface DocFaqDeps {
  extract: (chunk: FaqChunk, doc: DocFaqDoc) => Promise<RawFaqItem[]>;
  /** 같은 인증 종류의 approved + draft FAQ(과 이번 작업에서 방금 만든 질문)에 의미가 같은 질문이 있는지 (findSimilarFaq) */
  isDuplicate: (question: string, certType: string, justCreated: string[]) => Promise<{ duplicate: boolean; of?: string; id?: string }>;
  /** 질문·답변 쌍 문서용: 쌍마다 카테고리·컨설팅 여부를 판정한다 (글자는 바꾸지 않음) */
  classifyQa?: (pairs: { question: string; answer: string }[]) => Promise<QaClassification[]>;
}

/** 1) 대상 문서 확인. is_source=false 는 문서 분류 '기타 (초안 제외)' 로 표현한다. */
export function checkDocumentForFaq(doc: Pick<DocFaqDoc, "status" | "doc_category"> & { doc_format?: DocFormat; format_confirmed?: boolean }): { ok: true } | { ok: false; reason: string } {
  if (doc.status === "archived") return { ok: false, reason: "이전 버전 문서는 FAQ 초안을 만들지 않습니다. 최신 버전에서 실행하세요." };
  if (doc.status !== "extracted") return { ok: false, reason: "텍스트 추출이 끝난 문서('추출 완료')만 FAQ 초안을 만들 수 있습니다." };
  if (doc.doc_category === "other") return { ok: false, reason: "분류가 '기타 (초안 제외)'인 문서는 FAQ 초안의 재료로 쓰지 않습니다. 분류를 바꿔 다시 올려 주세요." };
  if (doc.doc_format === "qa_pairs" && doc.format_confirmed === false) return { ok: false, reason: "질문·답변 문서는 업로드 후 미리보기로 형식을 확인해야 FAQ 초안을 만들 수 있습니다. 문서 행의 [형식 확인]을 눌러 주세요." };
  return { ok: true };
}

/** 컨설팅 질문 표현 점검 (모델 판정의 보조). 기준 충족·통과·작성 요령을 묻는 표현. */
const CONSULTING_QUESTION = /어떻게 하면|통과하려면|통과하기 위해|통과 요령|합격하려면|맞추려면|충족시키려면|충족하려면|개선하려면|작성 요령|작성하는 요령|준비 요령|팁/;

const MAX_QUESTION_LEN = 300;
const MAX_ANSWER_LEN = 3000;
const CATEGORIES: FaqCategory[] = ["procedure", "cost", "duration", "document", "scope", "renewal"];
const snippet = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
const hasDigit = (s: string) => /\d/.test(s);
const evidenceFound = (evidence: string[], source: string) => {
  const src = norm(source);
  return evidence.length > 0 && evidence.every((e) => norm(e) && src.includes(norm(e)));
};

export type ScreenResult = { ok: true; draft: DocFaqDraft } | { ok: false; rejected: DocFaqRejected };

function draftOf(
  doc: DocFaqDoc,
  chunk: FaqChunk,
  v: { question: string; variants: string[]; answer: string; category: FaqCategory; evidence: string[]; needs_input: boolean; note: string },
): DocFaqDraft {
  return {
    question: v.question,
    variants: (v.variants ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5),
    answer: v.answer,
    category: v.category,
    cert_type: doc.cert_type,
    source_doc_id: doc.id,
    source_page: chunk.page_no,
    source_evidence: v.evidence,
    needs_input: v.needs_input,
    draft_note: `${AUTO_NOTE_PREFIX} ${doc.file_name}${chunk.page_no ? ` p.${chunk.page_no}` : ""}${v.note ? ` — ${v.note}` : ""}`,
  };
}

/** 거름망 a)~d). 중복(e)은 문서 전체 맥락이 필요해 processChunks 에서 따로 한다. */
export function screenItem(raw: RawFaqItem, chunk: FaqChunk, doc: DocFaqDoc): ScreenResult {
  const reject = (stage: string, reason: string): ScreenResult => ({
    ok: false,
    rejected: { page: chunk.page_no, content: snippet(raw.question?.trim() || raw.evidence?.[0] || chunk.content), reason, stage },
  });
  const question = (raw.question ?? "").trim();
  if (!question) return reject("evidence", "질문이 비어 있음");
  if (raw.kind === "consulting") return reject("consulting", `컨설팅성 내용${raw.reason ? `: ${raw.reason}` : ""}`);
  if (raw.kind === "other_authority") return reject("other_authority", `IGSC 소관이 아닌 타 기관·법정 제도 안내${raw.reason ? `: ${raw.reason}` : ""}`);
  if (CONSULTING_QUESTION.test(question)) return reject("consulting", "컨설팅성 질문 표현(기준 충족·통과 방법을 묻는 질문)");
  const category: FaqCategory = CATEGORIES.includes(raw.category) ? raw.category : "scope";
  const evidence = (raw.evidence ?? []).map((e) => String(e)).filter((e) => e.trim());

  const costDuration = category === "cost" || category === "duration";
  const answer = (raw.answer ?? "").trim();

  if (costDuration && !hasDigit(answer)) {
    // 원문에 비용·기간 수치가 없다: 빈 답변 + needs_input (담당자가 값을 채운다). 모델이 쓴 문장은 버린다.
    if (!evidenceFound(evidence, chunk.content)) return reject("evidence", "evidence가 청크 원문에 없음");
    return {
      ok: true,
      draft: draftOf(doc, chunk, { question, variants: raw.variants, answer: "", category, evidence, needs_input: true, note: "원문에 비용·기간 수치가 없어 담당자 입력이 필요합니다." }),
    };
  }

  const err = validateEvidence({ answer, evidence }, chunk.content, { strictNumbers: true });
  if (err) return reject(err.includes("숫자") ? "numbers" : "evidence", err);
  return { ok: true, draft: draftOf(doc, chunk, { question, variants: raw.variants, answer, category, evidence, needs_input: false, note: "" }) };
}

interface Screened {
  draft: DocFaqDraft;
  page: number | null;
}

/**
 * 거름망을 통과한 후보에서 중복(e)을 걸러낸다: 같은 인증 종류의 기존 FAQ(승인·초안)와 이번 작업에서 방금 만든 질문과 비교.
 * 같은 질문이라도 인증 종류가 다르면 중복이 아니다. 중복 판정에 실패하면 만들지 않는다.
 */
async function dedupe(
  candidates: Screened[],
  doc: DocFaqDoc,
  existing: ExistingQuestion[],
  deps: DocFaqDeps,
  alreadyCreated: string[],
  rejected: DocFaqRejected[],
): Promise<DocFaqDraft[]> {
  const sameCert = new Map(existing.filter((e) => e.cert_type === doc.cert_type).map((e) => [norm(e.question), e]));
  const created = [...alreadyCreated];
  const drafts: DocFaqDraft[] = [];
  for (const { draft, page } of candidates) {
    const q = draft.question;
    const exact = sameCert.get(norm(q));
    if (exact || created.some((c) => norm(c) === norm(q))) {
      rejected.push({ page, content: snippet(q), reason: "기존 FAQ와 중복: 같은 질문이 이미 있음", stage: "duplicate", ...(exact?.id ? { faq_id: exact.id } : {}) });
      continue;
    }
    let dup: { duplicate: boolean; of?: string; id?: string };
    try {
      dup = await deps.isDuplicate(q, doc.cert_type, created);
    } catch (err) {
      // 중복 판정 실패 시 만들지 않는다: 중복 초안이 쌓이는 쪽이 검수 부담이 크다
      console.error("[doc-faq] 중복 검사 실패:", err);
      rejected.push({ page, content: snippet(q), reason: "중복 검사에 실패해 만들지 않음(다시 만들기로 재시도 가능)", stage: "error" });
      continue;
    }
    if (dup.duplicate) {
      rejected.push({ page, content: snippet(q), reason: `기존 FAQ와 중복${dup.of ? `: 「${snippet(dup.of, 50)}」` : ""}`, stage: "duplicate", ...(dup.id ? { faq_id: dup.id } : {}) });
      continue;
    }
    drafts.push(draft);
    created.push(q);
  }
  return drafts;
}

/** 청크 묶음 처리: 추출(병렬) → 거름망 → 중복 검사(순차). 한 청크가 실패해도 나머지는 계속한다. */
export async function processChunks(
  chunks: FaqChunk[],
  doc: DocFaqDoc,
  existing: ExistingQuestion[],
  deps: DocFaqDeps,
  alreadyCreated: string[] = [],
): Promise<{ drafts: DocFaqDraft[]; rejected: DocFaqRejected[] }> {
  const rejected: DocFaqRejected[] = [];
  const extracted = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        return { chunk, items: await deps.extract(chunk, doc), error: null as string | null };
      } catch (err) {
        console.error("[doc-faq] 청크 추출 실패:", err);
        return { chunk, items: [] as RawFaqItem[], error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const screened: Screened[] = [];
  for (const { chunk, items, error } of extracted) {
    if (error) {
      rejected.push({ page: chunk.page_no, content: snippet(chunk.content), reason: `처리 실패(다시 만들기로 재시도 가능): ${error.slice(0, 80)}`, stage: "error" });
      continue;
    }
    // 청크당 최대 MAX_FAQ_PER_CHUNK 건 (모델이 더 많이 내도 앞의 3건만 본다)
    for (const raw of items.slice(0, MAX_FAQ_PER_CHUNK)) {
      const res = screenItem(raw, chunk, doc);
      if (res.ok) screened.push({ draft: res.draft, page: chunk.page_no });
      else rejected.push(res.rejected);
    }
  }
  const drafts = await dedupe(screened, doc, existing, deps, alreadyCreated, rejected);
  return { drafts, rejected };
}

export interface QaClassification {
  category: FaqCategory;
  consulting: boolean;
}

/**
 * 질문·답변 쌍 문서(doc_format='qa_pairs') 처리. 질문·답변은 원문 그대로이며 AI 는 분류(카테고리·컨설팅 여부)만 한다.
 *  - 컨설팅성 쌍 탈락, 같은 인증 종류의 기존 FAQ와 중복이면 탈락(일반 경로와 동일한 검사)
 *  - evidence 는 원문 전체가 근거이므로 질문·답변 쌍 자체를 기록한다.
 *  - 길이 제한(질문 300자, 답변 3000자)을 넘거나 답변이 비어 있으면 탈락(원문을 줄이거나 채우지 않는다).
 */
export async function processQaPairs(
  pairs: QaPair[],
  doc: DocFaqDoc,
  existing: ExistingQuestion[],
  deps: DocFaqDeps,
  alreadyCreated: string[] = [],
): Promise<{ drafts: DocFaqDraft[]; rejected: DocFaqRejected[] }> {
  const rejected: DocFaqRejected[] = [];
  const reject = (p: QaPair, stage: string, reason: string) => {
    rejected.push({ page: p.page, content: snippet(p.question), reason, stage });
  };

  let cls: QaClassification[];
  try {
    if (!deps.classifyQa) throw new Error("분류기가 없습니다.");
    cls = await deps.classifyQa(pairs.map((p) => ({ question: p.question, answer: p.answer })));
  } catch (err) {
    console.error("[doc-faq] 질문·답변 분류 실패:", err);
    for (const p of pairs) reject(p, "error", `처리 실패(다시 만들기로 재시도 가능): ${err instanceof Error ? err.message.slice(0, 60) : "분류 실패"}`);
    return { drafts: [], rejected };
  }

  const screened: Screened[] = [];
  pairs.forEach((p, i) => {
    const c = cls[i];
    if (!p.answer.trim()) return reject(p, "format", "답변이 비어 있음 (원문에 답변이 없는 질문)");
    if (p.question.length > MAX_QUESTION_LEN) return reject(p, "format", `질문이 ${MAX_QUESTION_LEN}자를 넘음`);
    if (p.answer.length > MAX_ANSWER_LEN) return reject(p, "format", `답변이 ${MAX_ANSWER_LEN}자를 넘음 (원문을 줄이지 않고 제외했습니다)`);
    if (c?.consulting || CONSULTING_QUESTION.test(p.question)) return reject(p, "consulting", "컨설팅성 내용(기준 충족·통과 방법 등)");
    const category: FaqCategory = c && CATEGORIES.includes(c.category) ? c.category : "scope";
    screened.push({
      page: p.page,
      draft: {
        question: p.question,
        variants: [],
        answer: p.answer,
        category,
        cert_type: doc.cert_type,
        source_doc_id: doc.id,
        source_page: p.page,
        source_evidence: [`${p.question}\n${p.answer}`],
        needs_input: false,
        draft_note: `${AUTO_NOTE_PREFIX} ${doc.file_name}${p.page ? ` p.${p.page}` : ""} — 질문·답변 원문 그대로`,
      },
    });
  });
  const drafts = await dedupe(screened, doc, existing, deps, alreadyCreated, rejected);
  return { drafts, rejected };
}

/**
 * 파일당 상한 적용: 이미 만든 건수(createdSoFar)에 이번 배치의 초안을 더해 상한(MAX_DRAFTS_PER_DOCUMENT)을 넘지 않게 자른다.
 * 넘치는 초안은 저장하지 않고 탈락 목록(stage='limit')에 남긴다. 상한에 도달했고 아직 처리하지 않은 구간이 남았거나
 * 넘친 초안이 있으면 limitReached 로 작업을 중단한다.
 */
export function applyDraftCap(
  createdSoFar: number,
  drafts: DocFaqDraft[],
  processedUpTo: number,
  totalUnits: number,
  max = MAX_DRAFTS_PER_DOCUMENT,
): { keep: DocFaqDraft[]; cut: DocFaqRejected[]; limitReached: boolean } {
  const room = Math.max(0, max - createdSoFar);
  const keep = drafts.slice(0, room);
  const cut: DocFaqRejected[] = drafts.slice(room).map((d) => ({
    page: d.source_page,
    content: d.question,
    reason: `파일당 상한(${max}건) 도달: 문서를 나누어 올려 주세요`,
    stage: "limit",
  }));
  const reached = createdSoFar + keep.length >= max;
  return { keep, cut, limitReached: reached && (processedUpTo < totalUnits || cut.length > 0) };
}

export interface ReplaceRow {
  id: string;
  status: string;
  draft_note: string | null;
  source_unanswered_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 문서의 FAQ 초안 만들기를 마치고 모두 승인했는지 (문서 보관함에서 [FAQ 초안 만들기] 버튼을 숨기는 기준).
 *  - 이 문서를 출처로 하는 FAQ 가 있고, 미검수·보류가 하나도 없어야 한다 (전부 승인).
 *  - 작업 기록이 있으면 다시 시도할 일이 남지 않아야 한다: 진행 중·실패한 작업, 파일당 상한 도달(남은 구간 미처리),
 *    '처리 실패'로 탈락한 항목이 있으면 버튼을 계속 보여준다.
 *  - 승인된 FAQ 를 바꾸는 방법은 개정판 올리기(재검토 표시) 또는 FAQ 수정이다. FAQ 를 초안으로 되돌리면 버튼이 다시 나타난다.
 */
export function isApprovalComplete(
  counts: { created: number; approved: number; pending: number; held: number } | undefined,
  job: { status: string; limit_reached?: boolean; error_count?: number } | null,
): boolean {
  if (!counts || counts.created === 0) return false;
  if (counts.pending > 0 || counts.held > 0) return false;
  if (job) {
    if (job.status === "running" || job.status === "failed") return false;
    if (job.limit_reached) return false;
    if ((job.error_count ?? 0) > 0) return false;
  }
  return true;
}

/** 수정 여부 판단 허용 오차 (INSERT 직후 트리거로 생기는 시각 차이) */
const EDIT_TOLERANCE_MS = 5000;

/**
 * 재실행 시 교체(삭제)해도 되는 초안과 보호할 초안을 가른다.
 * 교체 대상: status='draft', 이 기능이 만든 항목(메모 접두어), 미답변 질문에서 만든 것이 아님, 만든 뒤 수정되지 않음.
 * approved 는 어떤 경우에도 대상이 아니다.
 */
export function classifyReplaceable(rows: ReplaceRow[]): { replace: string[]; protect: string[] } {
  const replace: string[] = [];
  const protect: string[] = [];
  for (const r of rows) {
    if (r.status !== "draft") continue; // approved 등은 아예 건드리지 않는다 (보호 건수에도 넣지 않는다)
    const auto = (r.draft_note ?? "").startsWith(AUTO_NOTE_PREFIX);
    const fromUnanswered = r.source_unanswered_id !== null;
    const edited = new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > EDIT_TOLERANCE_MS;
    if (auto && !fromUnanswered && !edited) replace.push(r.id);
    else protect.push(r.id);
  }
  return { replace, protect };
}
