/**
 * 고객이 보내 준 인증 비용·소요기간(2026-10-07)으로 FAQ 초안을 만들고, 기존 비용·기간 '초안'은 삭제한다.
 *   npx tsx scripts/load-cost-duration-faqs.ts           미리보기 (DB 쓰기 없음)
 *   npx tsx scripts/load-cost-duration-faqs.ts --apply    백업 저장 → 기존 비용·기간 초안 삭제 → 새 초안 등록
 *
 * - 삭제 대상은 status='draft' 이고 category 가 cost/duration 인 행뿐이다. 승인된 FAQ 는 건드리지 않는다.
 * - 새 FAQ 는 모두 status='draft' (승인은 사람이 관리자 화면에서). 값은 고객이 보낸 내용 그대로이며 추정·보충하지 않는다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

const NOTE = "[고객 제공 2026-10-07] 인증 비용·소요기간 안내 메일 기준. VAT 포함 여부·적용 기준일은 고객 확인 필요.";

interface Item {
  cert_type: string;
  category: "cost" | "duration";
  question: string;
  variants: string[];
  answer: string;
}

const ITEMS: Item[] = [
  // ── 공통 (전체 안내) ─────────────────────────────────────────────
  {
    cert_type: "common",
    category: "cost",
    question: "인증 비용은 얼마인가요?",
    variants: ["인증 비용이 얼마예요", "인증 가격", "인증 심사 비용", "인증 비용 안내"],
    answer: [
      "인증 비용은 인증 종류에 따라 다릅니다.",
      "• 기본: 200만원 (신청 및 라이센스 비용 50만원 + 현장심사 및 인증위원회 상정 비용 100만원 + 시험분석 50만원)",
      "• 시험분석을 제외한 인증(제로웨이스트, 업사이클, 클린뷰티): 150만원",
      "• 서류심사로 진행하는 인증: 산호초 보호 인증은 국내용 50만원, 해외용 500만원이며, 비건 인증은 국내용 50만원입니다.",
      "• EPD 인증: 약 2,500만원 (EPD Global, International EPD)",
      "시험분석 비용이 다른 경우에는 최종 비용이 달라집니다. 반려동물 인증 탈취제는 시험분석 150만원, 최종 비용 300만원이고, 미세플라스틱 인증은 시험분석 100만원, 최종 비용 250만원입니다.",
    ].join("\n"),
  },
  {
    cert_type: "common",
    category: "duration",
    question: "인증 소요기간은 얼마나 걸리나요?",
    variants: ["인증까지 얼마나 걸려요", "인증 기간", "인증 발급 기간", "인증 소요 기간 안내"],
    answer: [
      "인증 소요기간은 인증 종류에 따라 다릅니다.",
      "• 기본: 현장심사 이후 4~6주",
      "• 시험분석을 제외한 인증(제로웨이스트, 업사이클, 클린뷰티): 4~6주",
      "• 서류심사로 진행하는 인증: 산호초 보호 인증은 국내용 2~3주, 해외용 6~7주이며, 비건 인증은 국내용 2~3주입니다.",
      "• EPD 인증: 1~2달 (LCA, EPD 보고서가 있는 경우)",
    ].join("\n"),
  },
  {
    cert_type: "common",
    category: "cost",
    question: "기본 인증 비용은 어떤 항목으로 구성되나요?",
    variants: ["인증 비용 구성", "인증 비용에 뭐가 포함되나요", "기본 비용 내역"],
    answer:
      "기본 인증 비용은 200만원이며, 신청 및 라이센스 비용 50만원, 현장심사 및 인증위원회 상정 비용 100만원, 시험분석 비용 50만원으로 구성됩니다.",
  },
  {
    cert_type: "common",
    category: "cost",
    question: "시험분석 비용이 달라지는 인증이 있나요?",
    variants: ["시험분석 비용이 다른 인증", "시험분석 비용 예외", "인증 비용이 더 비싼 경우"],
    answer: [
      "네, 시험분석 비용이 다른 인증은 최종 비용도 달라집니다.",
      "• 반려동물 인증 탈취제: 시험분석 150만원, 최종 비용 300만원",
      "• 미세플라스틱 인증: 시험분석 100만원, 최종 비용 250만원",
    ].join("\n"),
  },
  // ── 인증별 비용·기간 ─────────────────────────────────────────────
  {
    cert_type: "vegan",
    category: "cost",
    question: "비건(Vegan) 인증 비용은 얼마인가요?",
    variants: ["비건인증 얼마", "비건 인증 가격", "비건 인증 심사 비용"],
    answer: "비건 인증은 서류심사로 진행하며, 비용은 국내용 기준 50만원입니다.",
  },
  {
    cert_type: "vegan",
    category: "duration",
    question: "비건(Vegan) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["비건인증 기간", "비건 인증 얼마나 걸려요", "비건 인증 소요 기간"],
    answer: "비건 인증은 서류심사로 진행하며, 소요기간은 국내용 기준 2~3주입니다.",
  },
  {
    cert_type: "coral-reef-friendly",
    category: "cost",
    question: "산호초 보호(Coral Reef-friendly) 인증 비용은 얼마인가요?",
    variants: ["산호초 보호 인증 얼마", "산호초 인증 가격", "산호초 보호 인증 심사 비용"],
    answer: "산호초 보호 인증은 서류심사로 진행하며, 비용은 국내용 50만원, 해외용 500만원입니다.",
  },
  {
    cert_type: "coral-reef-friendly",
    category: "duration",
    question: "산호초 보호(Coral Reef-friendly) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["산호초 보호 인증 기간", "산호초 인증 얼마나 걸려요", "산호초 보호 인증 소요 기간"],
    answer: "산호초 보호 인증은 서류심사로 진행하며, 소요기간은 국내용 2~3주, 해외용 6~7주입니다.",
  },
  {
    cert_type: "zero-waste",
    category: "cost",
    question: "제로웨이스트(Zero-waste) 인증 비용은 얼마인가요?",
    variants: ["제로웨이스트 인증 얼마", "제로웨이스트 인증 가격", "제로웨이스트 인증 심사 비용"],
    answer: "제로웨이스트 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다.",
  },
  {
    cert_type: "zero-waste",
    category: "duration",
    question: "제로웨이스트(Zero-waste) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["제로웨이스트 인증 기간", "제로웨이스트 인증 얼마나 걸려요", "제로웨이스트 인증 소요 기간"],
    answer: "제로웨이스트 인증의 소요기간은 4~6주입니다.",
  },
  {
    cert_type: "upcycle",
    category: "cost",
    question: "업사이클(Upcycle) 인증 비용은 얼마인가요?",
    variants: ["업사이클 인증 얼마", "업사이클 인증 가격", "업사이클 인증 심사 비용"],
    answer: "업사이클 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다.",
  },
  {
    cert_type: "upcycle",
    category: "duration",
    question: "업사이클(Upcycle) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["업사이클 인증 기간", "업사이클 인증 얼마나 걸려요", "업사이클 인증 소요 기간"],
    answer: "업사이클 인증의 소요기간은 4~6주입니다.",
  },
  {
    cert_type: "clean-beauty",
    category: "cost",
    question: "클린뷰티(Clean beauty) 인증 비용은 얼마인가요?",
    variants: ["클린뷰티 인증 얼마", "클린뷰티 인증 가격", "클린뷰티 인증 심사 비용"],
    answer: "클린뷰티 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다.",
  },
  {
    cert_type: "clean-beauty",
    category: "duration",
    question: "클린뷰티(Clean beauty) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["클린뷰티 인증 기간", "클린뷰티 인증 얼마나 걸려요", "클린뷰티 인증 소요 기간"],
    answer: "클린뷰티 인증의 소요기간은 4~6주입니다.",
  },
  {
    cert_type: "epd",
    category: "cost",
    question: "환경성적표지(EPD) 인증 비용은 얼마인가요?",
    variants: ["EPD 인증 얼마", "EPD 인증 가격", "EPD 비용", "환경성적표지 비용"],
    answer: "EPD 인증 비용은 약 2,500만원입니다. (EPD Global, International EPD)",
  },
  {
    cert_type: "epd",
    category: "duration",
    question: "환경성적표지(EPD) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["EPD 인증 기간", "EPD 인증 얼마나 걸려요", "EPD 소요 기간", "환경성적표지 기간"],
    answer: "EPD 인증의 소요기간은 1~2달입니다. (LCA, EPD 보고서가 있는 경우)",
  },
  {
    cert_type: "pet-related-product",
    category: "cost",
    question: "반려동물 관련 제품 인증 중 탈취제의 비용은 얼마인가요?",
    variants: ["반려동물 인증 탈취제 비용", "반려동물 탈취제 인증 얼마", "반려동물 탈취제 인증 가격"],
    answer: "반려동물 인증 탈취제는 시험분석 비용이 150만원이며, 최종 비용은 300만원입니다.",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: old, error } = await db.from("faq").select("*").eq("status", "draft").in("category", ["cost", "duration"]);
  if (error) throw error;
  const { count: approvedCostDuration } = await db.from("faq").select("id", { count: "exact", head: true }).eq("status", "approved").in("category", ["cost", "duration"]);
  console.log(`[cost-duration] 삭제 대상(초안): ${old?.length ?? 0}건 (cost ${old?.filter((r) => r.category === "cost").length}, duration ${old?.filter((r) => r.category === "duration").length})`);
  console.log(`[cost-duration] 유지(승인된 비용·기간 FAQ): ${approvedCostDuration}건`);
  console.log(`[cost-duration] 새로 만들 초안: ${ITEMS.length}건`);
  for (const it of ITEMS) console.log(`  - [${it.cert_type}/${it.category}] ${it.question}`);
  if (!apply) {
    console.log("\n미리보기입니다. 실행하려면 --apply");
    return;
  }

  await mkdir("data/backup", { recursive: true });
  const file = `data/backup/faq-cost-duration-drafts-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  await writeFile(file, JSON.stringify(old ?? [], null, 1), "utf8");
  console.log(`[cost-duration] 백업 저장: ${file}`);

  const ids = (old ?? []).map((r) => r.id as string);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: e2 } = await db.from("faq").delete().in("id", ids.slice(i, i + 100)).eq("status", "draft").select("id");
    if (e2) throw e2;
    deleted += data?.length ?? 0;
  }
  console.log(`[cost-duration] 기존 초안 삭제: ${deleted}건`);

  const rows = ITEMS.map((it) => ({ ...it, status: "draft", needs_input: false, lang: "ko", source_url: null, draft_note: NOTE }));
  const { data: ins, error: e3 } = await db.from("faq").insert(rows).select("id");
  if (e3) throw e3;
  console.log(`[cost-duration] 새 초안 등록: ${ins?.length ?? 0}건 (모두 초안 상태)`);
}

main().catch((err) => {
  console.error("[cost-duration] 실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
