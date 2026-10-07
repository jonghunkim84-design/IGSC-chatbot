/**
 * cert_history 경로 점검 (DB에는 쓰지 않는다 — 이력 행은 메모리에서만 만든다).
 * 실행: npm run verify:history
 *
 * 1) 실제 DB의 listPublicCertHistory() 가 빈 테이블에서 오류 없이 [] 를 반환하는지
 * 2) 분류(Claude) → 이력 선택(Claude) → 안내 문구 조립 경로가 이력이 있을 때 실제로 동작하는지
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { listPublicCertHistory } from "@/lib/db/cert-history";
import { runChat, type ChatDeps, type ChatRoute } from "@/lib/chat/run-chat";
import { MSG_ELIGIBILITY_DISCLAIMER, MSG_ELIGIBILITY_HANDOFF } from "@/lib/prompts/messages";
import type { CertHistory } from "@/lib/db/types";
import type { FaqMatch } from "@/lib/search";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

const rows: CertHistory[] = [
  { id: "h1", cert_type: "pet-related-product", product_category: "반려동물 위생용품", company_public: true, company_name: "예시상사", year: 2025 },
  { id: "h2", cert_type: "vegan", product_category: "식품(음료)", company_public: true, company_name: null, year: 2024 },
  { id: "h3", cert_type: "epd", product_category: "건축자재", company_public: true, company_name: "예시건설", year: 2023 },
];

async function run(message: string, deps: Partial<ChatDeps>) {
  let route: ChatRoute = "handoff";
  let text = "";
  const logs: string[] = [];
  const un: string[] = [];
  for await (const ev of runChat(
    { message },
    { logChat: async (r) => (logs.push(r.route), { id: "x" }), logUnanswered: async (q) => void un.push(q), hasApprovedFaq: async () => true, ...deps },
  )) {
    if (ev.type === "meta") route = ev.route;
    if (ev.type === "delta") text += ev.text;
  }
  return { route, text, logs, un };
}

async function main() {
  // 1) 실제 DB (빈 테이블)
  const real = await listPublicCertHistory();
  check(`실제 DB cert_history 조회 (빈 테이블) → 오류 없이 []`, Array.isArray(real) && real.length === 0, `${real.length}건`);

  // 2) 빈 이력일 때: TC-03 은 전용 담당자 안내
  {
    const r = await run("고체 탈취제도 반려동물 인증 되나요?", { search: async () => [], listHistory: async () => [] });
    check(`이력 없음 → 가능 여부 전용 담당자 안내(handoff)+unanswered`, r.route === "handoff" && r.text === MSG_ELIGIBILITY_HANDOFF && r.un.length === 1);
  }

  // 3) 이력이 있을 때: 분류·선택은 실제 Claude, 이력 행만 메모리
  {
    const r = await run("고체 탈취제도 반려동물 인증 되나요?", { search: async () => [], listHistory: async () => rows });
    check(
      `이력 있음 → 유사 이력만 선택해 안내 (반려동물 O, 건축자재/식품 X)`,
      r.route === "answered" && r.text.includes("반려동물 위생용품") && !r.text.includes("건축자재") && !r.text.includes("식품(음료)"),
      r.route,
    );
    check(`확답 금지 + 담당자 검토 문구`, r.text.includes(MSG_ELIGIBILITY_DISCLAIMER) && !/가능합니다|받으실 수 있습니다|인증됩니다/.test(r.text));
    check(`chat_log 는 answered 로 기록`, r.logs[0] === "answered");
    console.log("      ↳ " + r.text.replace(/\n/g, "\n        "));
  }

  // 4) 관련 없는 제품이면 이력을 억지로 붙이지 않고 담당자 안내
  {
    const r = await run("드론 배터리도 인증 되나요?", { search: async () => [], listHistory: async () => rows });
    check(`유사 이력 없음 → 담당자 안내(handoff)`, r.route === "handoff" && r.text === MSG_ELIGIBILITY_HANDOFF, `${r.route}`);
  }

  // 5) FAQ 근거 + 이력이 함께 있을 때: 답변 뒤에 이력이 붙고 면책 문구 포함
  {
    const faq: FaqMatch = {
      id: "22222222-2222-4222-8222-222222222222",
      question: "반려동물 관련 제품 인증은 어떤 인증인가요?",
      answer: "(테스트용 가상 FAQ) 반려동물 관련 제품에 부여되는 인증입니다.",
      source_url: "https://example.test/pet",
      cert_type: "pet-related-product",
      category: "scope",
      needs_input: false,
    };
    const r = await run("고체 탈취제도 반려동물 인증 되나요?", { search: async () => [faq], listHistory: async () => rows });
    check(
      `FAQ + 이력 동시: 답변·이력·출처·면책 문구 모두 포함`,
      r.route === "answered" && r.text.includes("반려동물 위생용품") && r.text.includes("https://example.test/pet") && r.text.includes(MSG_ELIGIBILITY_DISCLAIMER),
    );
    console.log("      ↳ " + r.text.replace(/\n/g, "\n        "));
  }

  // 6) 가능 여부가 아닌 일반 질문에서는 이력을 조회하지 않는다
  {
    let listed = 0;
    await run("탄소중립 인증은 얼마인가요?", { search: async () => [], listHistory: async () => (listed++, rows) });
    check(`가능 여부 질문이 아니면 cert_history 미조회`, listed === 0, `조회 ${listed}회`);
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
