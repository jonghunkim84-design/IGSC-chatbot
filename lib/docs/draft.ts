/**
 * 업로드 문서 → FAQ 답변 초안 (핵심 로직).
 * 이 파일은 DB·API 에 직접 접근하지 않는다 (DraftDeps 로 주입). 기본 구현은 lib/docs/default-deps.ts.
 *
 * 절대 원칙
 *  - 문서는 고객 답변의 근거가 아니라 초안의 재료다. 여기서 만든 초안은 항상 draft 로 저장되고, 승인은 사람만 한다.
 *  - 근거를 못 찾으면 답을 만들지 않는다.
 *  - 모델이 낸 초안은 코드가 다시 검증한다. 검증에 걸리면 그 초안은 버린다.
 */
import { CERT_NAMES, hasCertName } from "@/lib/cert-names";
import { DOC_CATEGORY_LABELS } from "@/lib/admin/labels";
import { bigramSet, norm, validateEvidence, weaklySupportedSentences } from "@/lib/ingest/evidence";
import { DOC_PICK_MAX } from "@/lib/prompts/doc-draft";
import type { FaqCategory } from "@/lib/db/types";

export interface DocInfo {
  id: string;
  file_name: string;
  cert_type: string;
  doc_category: string;
  /** 문서 안의 섹션 제목들 (문서 고르기용) */
  sections: string[];
  /** 문서 첫머리 미리보기 (섹션 제목이 없는 문서도 고를 수 있게) */
  preview?: string;
}

export interface DocChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page_no: number | null;
  section_title: string | null;
}

export interface LabeledChunk extends DocChunk {
  /** 프롬프트에서 쓰는 이름 (C1, C2 …) */
  label: string;
  file_name: string;
}

export interface DraftSource {
  document_id: string;
  file_name: string;
  page_no: number | null;
}

export interface Draft {
  answer: string;
  /** 원문에서 그대로 인용한 근거 문장 */
  evidence: string[];
  sources: DraftSource[];
  confidence: "high" | "medium" | "low";
}

export interface RawDraft {
  found: boolean;
  answer: string;
  category: FaqCategory;
  confidence: "high" | "medium" | "low";
  evidence: { chunk: string; quote: string }[];
}

export type DraftOutcome =
  | { status: "drafted"; draft: Draft; category: FaqCategory; primary: DraftSource; docCertType: string | null }
  | { status: "not_found"; reason: string; category: FaqCategory | null }
  | { status: "rejected"; reason: string; category: FaqCategory | null }
  | { status: "no_docs"; reason: string }
  /** 컨설팅·불만·범위 밖 질문이라 초안을 만들지 않음 (공평성 규칙은 이 경로에도 적용) */
  | { status: "blocked"; reason: string };

export interface DraftLog {
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
}

export interface DraftDeps {
  /** status='extracted' 이고 archived 가 아닌 문서 */
  loadDocs: (certType?: string) => Promise<DocInfo[]>;
  loadChunks: (documentIds: string[]) => Promise<DocChunk[]>;
  /** 문서가 많을 때 관련 문서를 고른다 (id 배열) */
  selectDocs: (question: string, docs: DocInfo[]) => Promise<string[]>;
  /** weakSentences: 직전 시도에서 근거 부족으로 걸린 문장들 (있으면 그 문장 없이 다시 쓰게 한다) */
  generate: (question: string, chunks: LabeledChunk[], weakSentences?: string[]) => Promise<RawDraft>;
  /** 질문이 초안 대상인지 (컨설팅·불만·범위 밖이면 ok=false). 없으면 검사하지 않는다 */
  screenQuestion?: (question: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  /** 완성된 초안 답변에 컨설팅성 조언이 섞였는지 (true 면 폐기). 없으면 검사하지 않는다 */
  screenAnswer?: (answer: string) => Promise<boolean>;
  log?: DraftLog;
}

export const CONTEXT_BUDGET_CHARS = 120_000;
export const MIN_QUOTE_CHARS = 6;
export const SUPPORT_THRESHOLD = 0.45;

const consoleLog: DraftLog = {
  info: (m, meta) => console.info(`[doc-draft] ${m}`, meta ?? ""),
  warn: (m, meta) => console.warn(`[doc-draft] ${m}`, meta ?? ""),
};

const certLabel = (slug: string) => (slug === "common" ? "공통" : hasCertName(slug) ? CERT_NAMES[slug] : slug);

/** 후보 문서 좁히기 1단계: 인증 종류가 있으면 해당 인증 + 공통 문서를 우선 (그런 문서가 있으면 다른 인증 문서는 제외) */
export function prioritizeDocs(docs: DocInfo[], certType?: string): DocInfo[] {
  if (!certType) return docs;
  const preferred = docs.filter((d) => d.cert_type === certType || d.cert_type === "common");
  return preferred.length > 0 ? preferred : docs;
}

/** 컨텍스트 예산을 넘으면 질문과 글자쌍이 많이 겹치는 조각부터 채운다 (임베딩 없이, 어휘 겹침만 사용) */
export function fitToBudget(question: string, chunks: DocChunk[], budget = CONTEXT_BUDGET_CHARS): DocChunk[] {
  const total = chunks.reduce((n, c) => n + c.content.length, 0);
  if (total <= budget) return chunks;
  const q = bigramSet(question);
  const scored = chunks.map((c) => {
    const b = bigramSet(c.content);
    let hit = 0;
    for (const g of q) if (b.has(g)) hit++;
    return { c, score: q.size ? hit / q.size : 0 };
  });
  scored.sort((a, b) => b.score - a.score);
  const kept: DocChunk[] = [];
  let used = 0;
  for (const { c } of scored) {
    if (used + c.content.length > budget) continue;
    kept.push(c);
    used += c.content.length;
  }
  return kept.sort((a, b) => (a.document_id === b.document_id ? a.chunk_index - b.chunk_index : a.document_id.localeCompare(b.document_id)));
}

/** "이 인증", "해당 인증" 같은 지시어·일반어는 대상 이름이 아니다 */
const SUBJECT_STOP = new Set(["이", "그", "저", "해당", "어떤", "어느", "각", "모든", "우리", "다른", "새로운", "일반", "일반적인", "특정", "기존", "신규", "국제", "인증", "검증", "심사", "마크", "받는", "받은", "하는", "위한", "대한", "관련", "카테고리", "제품", "분야", "종류", "유형", "항목", "서비스", "대상", "원료", "기관", "완제품"]);

/**
 * 질문이 "○○ 인증/검증/심사/마크" 처럼 대상을 이름으로 지목하면 그 이름(○○)을 돌려준다. (예: "할랄 인증 절차" → ["할랄"])
 * 대상 이름이 후보 문서 어디에도 없다면 문서로 답할 수 없는 질문이므로, 일반 안내 문서에서 엉뚱한 답을 끌어오지 않게 막는 데 쓴다.
 */
export function questionSubjects(question: string): string[] {
  const out = new Set<string>();
  for (const m of question.matchAll(/([가-힣A-Za-z0-9][가-힣A-Za-z0-9-]*)\s*(?:인증|검증|심사|마크)/gu)) {
    const term = m[1].replace(/(?:은|는|이|가|을|를|의|도|만|에서|으로|로|과|와)$/u, "");
    if (term.length >= 2 && !SUBJECT_STOP.has(term)) out.add(term);
  }
  return [...out];
}

/** 후보 문서(파일명·섹션 제목·본문)에 나오지 않는 대상 이름들 */
export function missingSubjects(subjects: string[], corpus: string): string[] {
  const c = norm(corpus).toLowerCase();
  return subjects.filter((s) => !c.includes(norm(s).toLowerCase()));
}

const SOURCE_MENTION = /(?:문서|자료|파일|안내서|매뉴얼|원문|규정집)/;
const SOURCE_VERB = /(?:따르면|따른|따라|근거|출처|기재|명시된|나와 있|언급)/;

/** 답변 속 "이는 ○○ 문서에 따른 내용입니다" 같은 출처 언급 문장은 사실이 아니라 형식이라 제거한다 (출처는 시스템이 따로 붙인다) */
export function stripSourceMentions(answer: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = answer
    .split(/(?<=[.!?。])\s+/)
    .filter((s) => {
      const meta = SOURCE_MENTION.test(s) && SOURCE_VERB.test(s) && [...s.replace(/[^\p{L}\p{N}]/gu, "")].length < 60;
      if (meta) removed.push(s);
      return !meta;
    });
  return { text: kept.join(" ").trim(), removed };
}

export type VerifyResult = { ok: true; draft: Draft; primary: DraftSource } | { ok: false; reason: string; weakSentences?: string[] };

/**
 * 모델이 낸 초안을 코드로 검증한다. 하나라도 어긋나면 버린다.
 *  1. evidence 가 있고, 각 quote 가 그 chunk 원문에 글자 그대로(공백 무시) 있을 것 (다른 chunk 의 문장을 가져다 붙인 것도 거부)
 *  2. 답변의 숫자가 인용한 원문의 숫자와 정확히 같을 것 (Phase 2 의 evidence 검증 재사용, 엄격 모드)
 *  3. 답변의 각 문장이 인용한 근거와 어휘가 충분히 겹칠 것 (근거 없는 문장 혼입 방지)
 */
export function verifyDraft(input: RawDraft, chunks: LabeledChunk[]): VerifyResult {
  const stripped = stripSourceMentions(input.answer);
  const raw: RawDraft = { ...input, answer: stripped.text };
  const byLabel = new Map(chunks.map((c) => [c.label.toUpperCase(), c]));
  if (!raw.answer.trim()) return { ok: false, reason: "빈 답변" };
  // evidence 를 빠뜨린 경우도 한 번 다시 쓰게 할 수 있도록 답변 문장을 돌려준다 (재작성 때 "근거를 반드시 인용"하라고 안내)
  if (!raw.evidence?.length) return { ok: false, reason: "evidence 없음", weakSentences: raw.answer.split(/(?<=[.!?。])\s+/).slice(0, 4).map((x) => x.slice(0, 120)) };

  // 너무 짧은 인용(번호·단어 한두 개)은 근거로 치지 않고 버린다. 쓸 만한 인용이 하나도 없으면 탈락(재작성 대상).
  // 버린 인용에 의존하던 숫자·문장은 아래 숫자·문장 검사에서 걸러진다.
  const usable = raw.evidence.filter((e) => norm(e.quote ?? "").length >= MIN_QUOTE_CHARS);
  if (usable.length === 0) return { ok: false, reason: "근거 문장이 너무 짧음", weakSentences: raw.answer.split(/(?<=[.!?。])\s+/).slice(0, 4).map((x) => x.slice(0, 120)) };
  raw.evidence = usable;

  const cited: LabeledChunk[] = [];
  for (const e of raw.evidence) {
    const chunk = byLabel.get(String(e.chunk ?? "").trim().toUpperCase());
    if (!chunk) return { ok: false, reason: `존재하지 않는 chunk 를 인용함: "${e.chunk}"` };
    const q = norm(e.quote ?? "");
    if (q.length < MIN_QUOTE_CHARS) return { ok: false, reason: "근거 문장이 너무 짧음" };
    if (!norm(chunk.content).includes(q)) return { ok: false, reason: `근거 문장이 ${chunk.label} 원문에 없음: "${(e.quote ?? "").slice(0, 40)}…"` };
    if (!cited.includes(chunk)) cited.push(chunk);
  }

  const quotes = raw.evidence.map((e) => e.quote.trim());
  // Phase 2 검증 재사용: 답변 숫자 ⊂ 인용한 원문의 숫자 (strict)
  const numberProblem = validateEvidence({ answer: raw.answer, evidence: quotes }, quotes.join("\n"), { strictNumbers: true });
  if (numberProblem) return { ok: false, reason: numberProblem };

  const weak = weaklySupportedSentences(raw.answer, quotes, SUPPORT_THRESHOLD);
  if (weak.length) return { ok: false, reason: `근거가 부족한 문장: "${weak[0].sentence.slice(0, 50)}…" (일치율 ${weak[0].score.toFixed(2)})`, weakSentences: weak.map((w) => w.sentence) };

  const seen = new Set<string>();
  const sources: DraftSource[] = [];
  for (const c of cited) {
    const key = `${c.document_id}|${c.page_no ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ document_id: c.document_id, file_name: c.file_name, page_no: c.page_no });
  }
  return { ok: true, draft: { answer: raw.answer.trim(), evidence: quotes, sources, confidence: raw.confidence }, primary: sources[0] };
}

/**
 * 질문에 대한 답변 초안을 문서에서 찾아 만든다.
 * 결과: drafted(검증 통과) | not_found(근거 없음) | rejected(검증 실패로 폐기) | no_docs(후보 문서 없음)
 */
export async function draftFromDocs(question: string, certType: string | undefined, deps: DraftDeps): Promise<DraftOutcome> {
  const log = deps.log ?? consoleLog;
  const q = question.trim();
  const tag = q.slice(0, 40);

  // 0) 공평성: 컨설팅·불만·범위 밖 질문은 문서가 있어도 초안을 만들지 않는다
  if (deps.screenQuestion) {
    const s = await deps.screenQuestion(q);
    if (!s.ok) {
      log.warn("초안 차단(공평성/범위)", { question: tag, reason: s.reason });
      return { status: "blocked", reason: s.reason };
    }
  }

  // 1) 후보 문서 좁히기
  const all = await deps.loadDocs(certType);
  const candidates = prioritizeDocs(all, certType);
  if (candidates.length === 0) {
    log.info("후보 문서 없음", { question: tag });
    return { status: "no_docs", reason: "추출이 끝난 문서가 없습니다." };
  }
  const brief = (ds: DocInfo[]) => ds.map((d) => `${d.file_name} [${certLabel(d.cert_type)}/${DOC_CATEGORY_LABELS[d.doc_category] ?? d.doc_category}]`);
  log.info("후보 문서", { question: tag, certType: certType ?? "(지정 안 함)", loaded: all.length, afterCertFilter: candidates.length, docs: brief(candidates), pickStep: "항상 실행" });
  // 문서가 몇 개든 항상 질문과 관련된 문서를 고른다 (관련 없는 문서가 근거로 끌려오는 것을 막기 위함)
  const pickedIds = (await deps.selectDocs(q, candidates)).slice(0, DOC_PICK_MAX);
  const selected = candidates.filter((d) => pickedIds.includes(d.id));
  log.info("문서 선택 결과", { question: tag, picked: brief(selected), dropped: brief(candidates.filter((d) => !pickedIds.includes(d.id))) });
  if (selected.length === 0) {
    log.info("관련 문서를 고르지 못함", { question: tag, candidates: candidates.length });
    return { status: "not_found", reason: "관련 문서를 찾지 못했습니다.", category: null };
  }

  // 2) 조각을 컨텍스트로 넣어 초안 작성
  const docById = new Map(selected.map((d) => [d.id, d]));
  const chunks = fitToBudget(q, await deps.loadChunks(selected.map((d) => d.id)));
  if (chunks.length === 0) return { status: "not_found", reason: "문서에서 읽을 수 있는 내용이 없습니다.", category: null };
  // 질문이 특정 인증 등을 이름으로 지목하는데 그 이름이 문서에 없으면, 모델을 부르지 않고 근거 없음으로 처리한다
  const subjects = questionSubjects(q);
  const absent = missingSubjects(subjects, [...selected.map((d) => `${d.file_name} ${d.sections.join(" ")}`), ...chunks.map((c) => `${c.section_title ?? ""} ${c.content}`)].join(String.fromCharCode(10)));
  if (absent.length > 0) {
    log.info("질문의 대상이 문서에 없음", { question: tag, absent });
    return { status: "not_found", reason: `질문에서 지목한 '${absent[0]}'이(가) 문서에 나오지 않습니다.`, category: null };
  }
  const labeled: LabeledChunk[] = chunks.map((c, i) => ({ ...c, label: `C${i + 1}`, file_name: docById.get(c.document_id)?.file_name ?? "" }));
  const raw = await deps.generate(q, labeled);

  if (!raw.found || !raw.answer.trim()) {
    log.info("근거를 찾지 못함", { question: tag, docs: selected.length, chunks: labeled.length });
    return { status: "not_found", reason: "문서에서 근거를 찾지 못했습니다.", category: raw.category ?? null };
  }

  // 3) 코드 검증
  let v = verifyDraft(raw, labeled);
  let finalRaw = raw;
  // 근거가 부족한 문장 때문에 탈락했다면, 그 문장을 알려 주고 한 번만 다시 쓰게 한다. 다시 쓴 결과도 같은 검증을 전부 통과해야 한다.
  if (!v.ok && v.weakSentences?.length) {
    log.warn("초안 검증 탈락 → 1회 재작성", { question: tag, reason: v.reason });
    const retry = await deps.generate(q, labeled, v.weakSentences);
    if (retry.found && retry.answer.trim()) {
      finalRaw = retry;
      v = verifyDraft(retry, labeled);
    }
  }
  const dropped = stripSourceMentions(finalRaw.answer).removed;
  if (dropped.length) log.info("출처 언급 문장 제거", { question: tag, removed: dropped.map((x) => x.slice(0, 40)) });
  if (!v.ok) {
    log.warn("초안 폐기(근거 검증 실패)", { question: tag, reason: v.reason, answer: finalRaw.answer.slice(0, 80) });
    return { status: "rejected", reason: v.reason, category: finalRaw.category ?? raw.category ?? null };
  }
  // 문서에 컨설팅성 조언이 있더라도 그것이 FAQ 초안이 되지 않게 한다
  if (deps.screenAnswer && (await deps.screenAnswer(v.draft.answer))) {
    log.warn("초안 폐기(컨설팅성 내용)", { question: tag, answer: v.draft.answer.slice(0, 80) });
    return { status: "rejected", reason: "컨설팅성 조언이 포함되어 있어 폐기했습니다 (인증기관은 컨설팅을 제공하지 않습니다).", category: raw.category ?? null };
  }
  const docCertType = docById.get(v.primary.document_id)?.cert_type ?? null;
  log.info("초안 생성", { question: tag, sources: v.draft.sources.map((x) => `${x.file_name}${x.page_no ? ` p.${x.page_no}` : ""}`), docCategory: docById.get(v.primary.document_id)?.doc_category, confidence: v.draft.confidence });
  return { status: "drafted", draft: v.draft, category: finalRaw.category, primary: v.primary, docCertType };
}

export { certLabel, DOC_CATEGORY_LABELS };
