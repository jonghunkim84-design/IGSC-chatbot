import { randomUUID } from "node:crypto";
import { insertChatLog } from "@/lib/db/chat-log";
import { listPublicCertHistory } from "@/lib/db/cert-history";
import { insertUnanswered } from "@/lib/db/unanswered";
import type { CertHistory, NewChatLog } from "@/lib/db/types";
import { NO_ANSWER_SENTINEL, PARTIAL_SENTINEL } from "@/lib/prompts/answer";
import {
  MSG_COMPLAINT,
  MSG_CLARIFY_CERT,
  MSG_CONSULTING_BLOCKED,
  MSG_COST_DURATION_DISCLAIMER,
  MSG_ELIGIBILITY_DISCLAIMER,
  MSG_ELIGIBILITY_HANDOFF,
  MSG_ERROR_HANDOFF,
  MSG_HANDOFF,
  MSG_HISTORY_INTRO,
  MSG_LANGUAGE_UNSUPPORTED,
  MSG_NEEDS_INPUT_HANDOFF,
  MSG_PARTIAL_FALLBACK_LINE,
  MSG_PARTIAL_HANDOFF,
  MSG_PREPARING,
  MSG_OUT_OF_SCOPE,
  MSG_SOURCES_LABEL,
} from "@/lib/prompts/messages";
import { certName } from "@/lib/cert-names";
import { searchFaq, type FaqMatch } from "@/lib/search";
import { getFaqIndex } from "@/lib/search/faq-cache";
import { streamAnswer } from "./answer";
import { classifyQuestion, type Classification } from "./classify";
import { formatHistoryLines, selectSimilarHistory } from "./history";

export type ChatRoute = NewChatLog["route"] | "out_of_scope" | "clarify";

/** 되묻기(clarify) 응답에서 고객이 고를 인증 종류 버튼 */
export interface CertOption {
  certType: string;
  label: string;
}

export type ChatEvent =
  | { type: "meta"; sessionId: string; route: ChatRoute; sources: string[]; options?: CertOption[] }
  | { type: "delta"; text: string }
  | { type: "done" };

export interface ChatInput {
  message: string;
  sessionId?: string;
  certType?: string;
  /** 되묻기 이후 후속 요청일 때 이전 질문 (예: "인증받는 데 얼마나 걸려요?" → "비건이요") */
  previousQuestion?: string;
  /** 유입 채널(정리된 값, lib/channels.ts). 기록에만 쓰이고 답변에는 영향이 없다. */
  source?: string | null;
  sourceDetail?: string | null;
}

export interface ChatDeps {
  classify: (q: string) => Promise<Classification>;
  search: (q: string, certType?: string) => Promise<FaqMatch[]>;
  listHistory: (certType?: string) => Promise<CertHistory[]>;
  selectHistory: (q: string, rows: CertHistory[]) => Promise<CertHistory[]>;
  streamAnswer: (q: string, matches: FaqMatch[], opts: { eligibility: boolean }) => AsyncIterable<string>;
  /** 되묻기 버튼에 쓸 인증 종류 (승인된 FAQ가 있는 인증만) */
  listCertOptions: () => Promise<CertOption[]>;
  /** 승인된 FAQ 가 하나라도 있는가. 없으면 인증 문의에 "AI 답변 준비 중" 안내를 낸다. */
  hasApprovedFaq: () => Promise<boolean>;
  logChat: (row: Omit<NewChatLog, "route"> & { route: ChatRoute }) => Promise<{ id: string }>;
  logUnanswered: (question: string, chatLogId?: string) => Promise<unknown>;
}

const defaultDeps: ChatDeps = {
  classify: classifyQuestion,
  search: searchFaq,
  listHistory: listPublicCertHistory,
  selectHistory: selectSimilarHistory,
  streamAnswer,
  listCertOptions: listApprovedCertOptions,
  hasApprovedFaq: async () => (await getFaqIndex()).length > 0,
  // chat_log.route 에 'out_of_scope' 를 허용하려면 supabase/migrations/0002 적용이 필요하다.
  logChat: (row) => insertChatLog(row as NewChatLog),
  logUnanswered: insertUnanswered,
};

const MAX_CERT_OPTIONS = 8;

/** 승인된 FAQ가 있는 인증 종류를 FAQ 수 많은 순으로 (공통 제외). 버튼을 눌렀을 때 실제로 답할 수 있는 인증만 보여주기 위함. */
async function listApprovedCertOptions(): Promise<CertOption[]> {
  const counts = new Map<string, number>();
  for (const f of await getFaqIndex()) {
    if (f.cert_type !== "common") counts.set(f.cert_type, (counts.get(f.cert_type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_CERT_OPTIONS)
    .map(([certType]) => ({ certType, label: certName(certType) }));
}

const COST_DURATION = new Set(["cost", "duration"]);

/** 한글이 없고 영어 단어가 2개 이상이면 외국어 문의로 본다 (현재 한국어만 지원). */
export const isForeignLanguage = (t: string) => !/[가-힣]/.test(t) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t);

/**
 * 처리 순서: 분류 → 분기 → FAQ 선택 → 답변 생성 → chat_log 적재. 단계를 건너뛰지 않는다.
 * 모델이 생성하는 응답은 allowed + FAQ 근거가 있을 때뿐이다. 나머지는 전부 고정 문구.
 */
export async function* runChat(input: ChatInput, deps: Partial<ChatDeps> = {}): AsyncGenerator<ChatEvent> {
  const d = { ...defaultDeps, ...deps };
  const sessionId = input.sessionId ?? randomUUID();
  const query = input.message.trim();
  // 되묻기 후속 요청이면 이전 질문과 합쳐서 분류·검색·답변에 사용한다.
  const effective = input.previousQuestion ? `${input.previousQuestion.trim()}\n${query}` : query;
  // 기록(chat_log·미답변)에도 합친 질문을 남긴다: "환경성적표지(EPD)" 만 남으면 무엇을 물었는지 알 수 없다.
  // 예) "인증 절차가 어떻게 되나요? / 환경성적표지(EPD)"
  const loggedQuestion = input.previousQuestion ? `${input.previousQuestion.trim()} / ${query}` : query;

  let route: ChatRoute = "handoff";
  let finalText = "";
  let matchedIds: string[] = [];
  let needsUnanswered = false;

  // 5) chat_log 적재 (+ 근거 없음이면 unanswered) 후 done 이벤트
  const finish = async function* (): AsyncGenerator<ChatEvent> {
    try {
      const log = await d.logChat({
        session_id: sessionId,
        question: loggedQuestion,
        answer: finalText,
        matched_faq_ids: matchedIds,
        route,
        source: input.source ?? null,
        source_detail: input.sourceDetail ?? null,
      });
      if (needsUnanswered) await d.logUnanswered(loggedQuestion, log.id);
    } catch (err) {
      console.error("[chat] chat_log/unanswered 적재 실패:", err);
      if (needsUnanswered) {
        try {
          await d.logUnanswered(loggedQuestion);
        } catch (err2) {
          console.error("[chat] unanswered 적재 실패:", err2);
        }
      }
    }

    yield { type: "done" };
  };

  try {
    // 1) 분류. FAQ 검색(약 1.7초)은 분류(약 0.7초)와 동시에 시작해 기다리는 시간을 줄인다.
    //    분류 결과가 거절·이관·범위 밖이면 검색 결과는 쓰지 않고 버린다(어디에도 기록·노출되지 않는다).
    //    한국어가 아닌 질문은 어차피 검색하지 않으므로 시작하지 않는다.
    const searchPromise = isForeignLanguage(effective) ? null : d.search(effective, input.certType);
    searchPromise?.catch(() => undefined); // 결과를 쓰지 않는 경우 오류가 처리되지 않은 거부로 남지 않게 한다 (쓰는 경우는 아래 await 에서 그대로 던져진다)
    const cls = await d.classify(effective);

    // 2) 분기
    if (cls.label === "consulting") {
      route = "consulting_blocked";
      finalText = MSG_CONSULTING_BLOCKED;
      yield { type: "meta", sessionId, route, sources: [] };
      yield { type: "delta", text: finalText };
    } else if (cls.label === "complaint") {
      route = "complaint";
      finalText = MSG_COMPLAINT;
      yield { type: "meta", sessionId, route, sources: [] };
      yield { type: "delta", text: finalText };
    } else if (cls.label === "out_of_scope") {
      route = "out_of_scope";
      finalText = MSG_OUT_OF_SCOPE;
      yield { type: "meta", sessionId, route, sources: [] };
      yield { type: "delta", text: finalText };
    } else {
      if (isForeignLanguage(effective)) {
        // 한국어 외 문의: 분류 이후 단계(검색·답변)로 넘기지 않고 담당자 연결 안내
        route = "handoff";
        finalText = MSG_LANGUAGE_UNSUPPORTED;
        needsUnanswered = true;
        yield { type: "meta", sessionId, route, sources: [] };
        yield { type: "delta", text: finalText };
        yield* finish();
        return;
      }

      // 승인된 FAQ 가 한 건도 없으면(공개 전·인계 직후) 검색·답변 없이 "준비 중" 안내를 낸다.
      // 컨설팅·불만·범위 밖은 위에서 이미 고정 문구로 처리되므로 영향이 없다. 확인에 실패하면 평소대로 진행한다.
      const hasFaq = await d.hasApprovedFaq().catch((err) => {
        console.error("[chat] 승인 FAQ 유무 확인 실패, 평소대로 진행:", err);
        return true;
      });
      if (!hasFaq) {
        route = "handoff";
        finalText = MSG_PREPARING;
        needsUnanswered = true;
        yield { type: "meta", sessionId, route, sources: [] };
        yield { type: "delta", text: finalText };
        yield* finish();
        return;
      }

      // 3) FAQ 선택 (+ 가능 여부 문의면 인증 이력 조회)
      const matches = await (searchPromise ?? d.search(effective, input.certType));
      matchedIds = matches.map((m) => m.id);

      let history: CertHistory[] = [];
      if (cls.eligibility) {
        // 인증 종류가 정해졌으면(고객 선택 또는 FAQ 매칭이 한 종류) 같은 인증의 이력만 후보로 쓴다.
        const matchedCerts = new Set(matches.map((m) => m.cert_type).filter((t) => t !== "common"));
        const historyCert = input.certType ?? (matchedCerts.size === 1 ? [...matchedCerts][0] : undefined);
        history = await d.selectHistory(effective, await d.listHistory(historyCert));
      }

      const handoff = function* (text: string): Generator<ChatEvent> {
        route = "handoff";
        finalText = text;
        needsUnanswered = true;
        yield { type: "meta", sessionId, route, sources: [] };
        yield { type: "delta", text };
      };

      if (matches.some((m) => m.needs_input)) {
        // 담당자 입력 대기 항목은 답변 생성에 쓰지 않는다
        yield* handoff(MSG_NEEDS_INPUT_HANDOFF);
      } else if (matches.length === 0 && history.length === 0) {
        if (cls.eligibility) {
          yield* handoff(MSG_ELIGIBILITY_HANDOFF);
        } else if (!cls.certSpecified && !input.certType && !input.previousQuestion) {
          // 인증 종류를 알 수 없고 근거도 없음 → 담당자 이관 대신 인증 종류를 되묻는다
          route = "clarify";
          finalText = MSG_CLARIFY_CERT;
          const options = await d.listCertOptions().catch((err) => {
            console.error("[chat] 되묻기 옵션 조회 실패:", err);
            return [] as CertOption[];
          });
          yield { type: "meta", sessionId, route, sources: [], options };
          yield { type: "delta", text: finalText };
        } else {
          yield* handoff(MSG_HANDOFF);
        }
      } else {
        const historyBlock = history.length
          ? `${MSG_HISTORY_INTRO}\n${formatHistoryLines(history).join("\n")}`
          : "";
        const sources = [...new Set(matches.map((m) => m.source_url).filter((u): u is string => Boolean(u)))];
        const notes: string[] = [];
        if (matches.some((m) => COST_DURATION.has(m.category))) notes.push(MSG_COST_DURATION_DISCLAIMER);
        if (cls.eligibility) notes.push(MSG_ELIGIBILITY_DISCLAIMER);

        if (matches.length === 0) {
          // FAQ 근거는 없지만 인증 이력은 있음 → DB 값으로만 조립한 안내 (가능 여부 확답 없음)
          route = "answered";
          finalText = [historyBlock, ...notes].join("\n\n");
          yield { type: "meta", sessionId, route, sources: [] };
          yield { type: "delta", text: finalText };
        } else {
          // 4) 답변 생성 (선택된 FAQ만 컨텍스트). 첫머리가 NO_ANSWER 표식인지 확인하기 위해 앞부분만 버퍼링.
          let buf = "";
          let decided = false;
          let noAnswer = false;
          let partial = false;
          let body = "";
          // 앞부분을 버퍼링해 NO_ANSWER / PARTIAL 표식을 확인한다. 표식은 고객에게 보이지 않게 제거한다.
          const startsSentinel = (t: string) => [NO_ANSWER_SENTINEL, PARTIAL_SENTINEL].some((x) => x.startsWith(t));
          const emitFirst = function* (text: string): Generator<ChatEvent> {
            decided = true;
            route = "answered";
            yield { type: "meta", sessionId, route, sources };
            body += text;
            if (text) yield { type: "delta", text };
          };
          for await (const chunk of d.streamAnswer(effective, matches, { eligibility: cls.eligibility })) {
            if (decided) {
              body += chunk;
              yield { type: "delta", text: chunk };
              continue;
            }
            buf += chunk;
            const t = buf.trimStart();
            if (t.startsWith(NO_ANSWER_SENTINEL)) {
              noAnswer = true;
              break;
            }
            if (t.startsWith(PARTIAL_SENTINEL)) {
              partial = true;
              yield* emitFirst(t.slice(PARTIAL_SENTINEL.length).trimStart());
              continue;
            }
            if (t.length < PARTIAL_SENTINEL.length && startsSentinel(t)) continue;
            yield* emitFirst(buf);
          }
          if (!decided && !noAnswer && buf.trim()) {
            const t = buf.trimStart();
            if (t.startsWith(PARTIAL_SENTINEL)) partial = true;
            yield* emitFirst(t.startsWith(PARTIAL_SENTINEL) ? t.slice(PARTIAL_SENTINEL.length).trimStart() : buf);
          }

          if (noAnswer || !decided) {
            // 모델이 제공된 FAQ로 답할 수 없다고 판단
            if (history.length) {
              route = "answered";
              finalText = [historyBlock, ...notes].join("\n\n");
              yield { type: "meta", sessionId, route, sources: [] };
              yield { type: "delta", text: finalText };
            } else {
              matchedIds = [];
              yield* handoff(cls.eligibility ? MSG_ELIGIBILITY_HANDOFF : MSG_HANDOFF);
            }
          } else {
            // 부분 안내인데 모델이 마지막 연결 문장을 쓰지 못했으면(길이 제한 등) 고정 문장으로 보완한다
            if (partial && !body.includes("담당자")) {
              const fallback = `

${MSG_PARTIAL_FALLBACK_LINE}`;
              body += fallback;
              yield { type: "delta", text: fallback };
            }
            const tail = [
              historyBlock,
              sources.length ? `${MSG_SOURCES_LABEL}:\n${sources.map((u) => `- ${u}`).join("\n")}` : "",
              ...notes,
              // 일부만 안내한 경우: 안내하지 못한 부분을 담당자가 확인하도록 연결하고 미답변 목록에 남긴다
              partial ? MSG_PARTIAL_HANDOFF : "",
            ]
              .filter(Boolean)
              .join("\n\n");
            if (tail) {
              body += `\n\n${tail}`;
              yield { type: "delta", text: `\n\n${tail}` };
            }
            finalText = body;
            if (partial) needsUnanswered = true;
          }
        }
      }
    }
  } catch (err) {
    // 에러는 삼키지 않고 로깅한 뒤 사용자에게는 담당자 연결 안내
    console.error("[chat] 처리 실패:", err);
    route = "handoff";
    finalText = MSG_ERROR_HANDOFF;
    needsUnanswered = true;
    matchedIds = [];
    yield { type: "meta", sessionId, route, sources: [] };
    yield { type: "delta", text: finalText };
  }

  yield* finish();
}
