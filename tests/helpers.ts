import { vi } from "vitest";
import { runChat, type ChatDeps, type ChatRoute, type CertOption } from "@/lib/chat/run-chat";
import { invalidateFaqCache } from "@/lib/search/faq-cache";
import { createSearchFaq, type FaqMatch } from "@/lib/search";
import type { FaqIndexItem } from "@/lib/db/faq";
import type { CertHistory } from "@/lib/db/types";

/**
 * 시나리오 테스트용 고정 데이터.
 * DB의 실제 승인 상태와 무관하게 결과가 같도록, FAQ/이력은 모두 여기서 주입한다.
 * (분류·FAQ 선택·답변 생성은 실제 Claude API를 호출한다.)
 * 숫자와 기관 정보는 테스트용 가상 값이다.
 */
export const FIXTURE_FAQS: FaqMatch[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    question: "비건 인증 비용은 얼마인가요?",
    answer:
      "비건 인증 심사 비용은 300만원에서 500만원 범위입니다. 제품 수, 생산시설 수, 현장심사 일수에 따라 달라질 수 있습니다.",
    source_url: "https://example.test/vegan-cost",
    cert_type: "vegan",
    category: "cost",
    needs_input: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    question: "식품 비건(Vegan) 인증의 원칙은 무엇인가요?",
    answer: "동물 및 동물 유래 성분 금지, 동물 실험 금지, 교차 오염 금지의 세 가지 원칙이 있습니다.",
    source_url: "https://example.test/vegan-principles",
    cert_type: "vegan",
    category: "scope",
    needs_input: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    question: "유기농(Organic) 인증이란 무엇인가요?",
    answer: "최소 3년 이상 농약과 화학비료를 사용하지 않고 재배한 농축산물로 만든 제품에 부여되는 인증입니다.",
    source_url: "https://example.test/organic",
    cert_type: "organic",
    category: "scope",
    needs_input: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    question: "이의제기나 불만은 어떻게 접수하나요?",
    answer: "FAX, 전화, 방문, 홈페이지 등으로 접수할 수 있습니다.",
    source_url: "https://example.test/appeals",
    cert_type: "common",
    category: "procedure",
    needs_input: false,
  },
  // 함정: 컨설팅성 내용이 담긴 FAQ가 (실수로) 승인되어 있어도 컨설팅 질문에는 절대 나가면 안 된다.
  {
    id: "00000000-0000-4000-8000-000000000099",
    question: "비건 기준에 맞추려면 무엇을 바꿔야 하나요?",
    answer: "LEAKCHECK 동물성 원료를 식물성 원료로 교체하고 세척 공정을 추가하세요.",
    source_url: "https://example.test/trap",
    cert_type: "vegan",
    category: "procedure",
    needs_input: false,
  },
];

export const FIXTURE_HISTORY: CertHistory[] = [
  { id: "h1", cert_type: "pet-related-product", product_category: "반려동물 위생용품", company_public: true, company_name: "예시상사", year: 2025 },
  { id: "h2", cert_type: "vegan", product_category: "식품(음료)", company_public: true, company_name: null, year: 2024 },
  { id: "h3", cert_type: "epd", product_category: "건축자재", company_public: true, company_name: "예시건설", year: 2023 },
];

export const FIXTURE_CERT_OPTIONS: CertOption[] = [
  { certType: "vegan", label: "비건(Vegan)" },
  { certType: "organic", label: "유기농(Organic)" },
];

const toIndex = (faqs: FaqMatch[]): FaqIndexItem[] =>
  faqs.map((f) => ({ id: f.id, question: f.question, variants: [], cert_type: f.cert_type }));

export interface ChatResult {
  route: ChatRoute;
  text: string;
  sources: string[];
  options: CertOption[];
  /** chat_log 에 기록하려던 행 */
  logs: { route: string; question: string; matched: number; answer: string | null | undefined }[];
  /** unanswered 에 적재하려던 질문 */
  unanswered: string[];
  spies: { search: ReturnType<typeof vi.fn>; streamAnswer: ReturnType<typeof vi.fn> };
}

/** FAQ 선택(searchFaq)까지 실제 Claude 로 수행하되 데이터는 fixture 를 쓰는 검색 함수 */
export function fixtureSearch(faqs: FaqMatch[] = FIXTURE_FAQS) {
  invalidateFaqCache(); // 다른 테스트가 남긴 전역 캐시가 섞이지 않게
  return createSearchFaq({
    loadIndex: async () => toIndex(faqs),
    loadAnswers: async (ids) => ids.map((id) => faqs.find((f) => f.id === id)!).filter(Boolean),
  });
}

export async function chat(message: string, overrides: Partial<ChatDeps> = {}, input: { certType?: string; previousQuestion?: string } = {}): Promise<ChatResult> {
  const logs: ChatResult["logs"] = [];
  const unanswered: string[] = [];
  const realSearch = overrides.search ?? fixtureSearch();
  const search = vi.fn(realSearch);
  const realStream = overrides.streamAnswer;
  const streamAnswer = vi.fn(
    realStream ??
      (async function* (...args: Parameters<ChatDeps["streamAnswer"]>) {
        const { streamAnswer: real } = await import("@/lib/chat/answer");
        yield* real(...args);
      }),
  );

  let route: ChatRoute = "handoff";
  let text = "";
  let sources: string[] = [];
  let options: CertOption[] = [];
  for await (const ev of runChat(
    { message, ...input },
    {
      listHistory: async () => [],
      listCertOptions: async () => FIXTURE_CERT_OPTIONS,
      hasApprovedFaq: async () => true,
      logChat: async (row) => {
        logs.push({ route: row.route, question: row.question, matched: row.matched_faq_ids?.length ?? 0, answer: row.answer });
        return { id: "log-1" };
      },
      logUnanswered: async (q) => void unanswered.push(q),
      ...overrides,
      search,
      streamAnswer,
    },
  )) {
    if (ev.type === "meta") {
      route = ev.route;
      sources = ev.sources;
      options = ev.options ?? [];
    }
    if (ev.type === "delta") text += ev.text;
  }
  return { route, text, sources, options, logs, unanswered, spies: { search, streamAnswer } };
}
