/**
 * 고객 확인(2026-10-07 2차)을 비용·기간 FAQ 에 반영한다.
 *   npx tsx scripts/update-cost-duration-faqs.ts           미리보기 (DB 쓰기 없음)
 *   npx tsx scripts/update-cost-duration-faqs.ts --apply    백업 저장 → 기존 17건 내용 갱신(초안으로 되돌림) → 새 FAQ 등록
 *
 * 반영한 확인 내용
 *  - 모든 금액은 부가세 별도
 *  - '기본' 인증 = 비건(해외용), Gluten Free, GMO Free, Sugar Free, Lactose Free/Dairy Free, Salt Free, Fat Free,
 *    Caffeine Free, Calorie Free, Ketogenic friendly, Plastic free → 200만원, 현장심사 이후 인증서 발급까지 4~6주
 *  - ISO 는 조직 직원 수에 따라 달라 별도 문의 (ISO 9001 예: 10명 190만원 / 50명 400만원 / 100명 540만원)
 *  - Microplastic-free 는 Plastic free 와 별도 인증, 비용 300만원 (인증 종류 microplastic-free 를 새로 등록)
 *  - 비건: 국내용 50만원(서류심사), 해외용(기본 비건) 200만원, 인증마크가 다름
 * 내용을 바꾼 기존 FAQ 는 사람이 다시 확인하도록 status='draft' 로 되돌리고 승인 기록을 지운다(승인은 사람만).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

const NOTE =
  "[고객 제공 2026-10-07] 인증 비용·소요기간 안내(2차 확인 반영): 금액은 부가세 별도, 기본 인증 범위 확정, ISO 별도 문의, Microplastic-free 별도 인증.";
const VAT = "(부가세 별도)";

interface Item {
  cert_type: string;
  category: "cost" | "duration";
  question: string;
  variants: string[];
  answer: string;
  note?: string;
}

const BASIC_LIST = "비건(해외용), Gluten Free, GMO Free, Sugar Free, Lactose Free/Dairy Free, Salt Free, Fat Free, Caffeine Free, Calorie Free, Ketogenic friendly, Plastic free";
const BASIC_COST_DETAIL = "신청 및 라이센스 비용 50만원 + 현장심사 및 인증위원회 상정 비용 100만원 + 시험분석 50만원";

/** 기본 인증 개별 FAQ (비용·기간) */
const BASIC_CERTS: { code: string; ko: string; en: string; aliases: string[] }[] = [
  { code: "gluten-free", ko: "글루텐프리(Gluten free)", en: "Gluten Free", aliases: ["글루텐프리", "Gluten Free"] },
  { code: "non-gmo", ko: "무유전자변형(Non-GMO)", en: "GMO Free", aliases: ["GMO Free", "Non-GMO", "무유전자변형"] },
  { code: "sugar-free", ko: "무설탕(Sugar free)", en: "Sugar Free", aliases: ["무설탕", "Sugar Free"] },
  { code: "lactose-free-dairy-free", ko: "무유당 / 무유제품(Lactose-free / Dairy-free)", en: "Lactose Free/Dairy Free", aliases: ["무유당", "무유제품", "Lactose Free", "Dairy Free"] },
  { code: "salt-free", ko: "무소금(Salt-free)", en: "Salt Free", aliases: ["무소금", "Salt Free"] },
  { code: "fat-free", ko: "무지방(Fat free)", en: "Fat Free", aliases: ["무지방", "Fat Free"] },
  { code: "calorie-free", ko: "칼로리프리(Calorie free)", en: "Calorie Free", aliases: ["칼로리프리", "Calorie Free"] },
  { code: "ketogenic-friendly", ko: "키토제닉 친화(Ketogenic friendly)", en: "Ketogenic friendly", aliases: ["키토제닉", "Ketogenic friendly"] },
  { code: "plastic-free", ko: "플라스틱 프리(Plastic free)", en: "Plastic free", aliases: ["플라스틱 프리", "Plastic free"] },
];

const basicItems: Item[] = BASIC_CERTS.flatMap((c) => {
  const short = c.aliases[0];
  const costExtra = c.code === "plastic-free" ? " Microplastic-free는 별도의 인증이며 비용이 다릅니다(300만원)." : "";
  return [
    {
      cert_type: c.code,
      category: "cost" as const,
      question: `${c.ko} 인증 비용은 얼마인가요?`,
      variants: [`${short} 인증 얼마`, `${short} 인증 가격`, `${c.en} 인증 비용`],
      answer: `${short} 인증은 기본 인증으로, 비용은 200만원입니다. ${VAT} (${BASIC_COST_DETAIL})${costExtra}`,
    },
    {
      cert_type: c.code,
      category: "duration" as const,
      question: `${c.ko} 인증은 소요기간이 얼마나 걸리나요?`,
      variants: [`${short} 인증 기간`, `${short} 인증 얼마나 걸려요`, `${c.en} 인증 소요 기간`],
      answer: `${short} 인증은 기본 인증으로, 소요기간은 현장심사 이후 인증서 발급까지 4~6주입니다.`,
    },
  ];
});

const ISO_EXAMPLE = "ISO 9001의 경우 직원 10명 190만원, 50명 400만원, 100명 540만원입니다.";

const ITEMS: Item[] = [
  // ── 공통 ───────────────────────────────────────────────
  {
    cert_type: "common",
    category: "cost",
    question: "인증 비용은 얼마인가요?",
    variants: ["인증 비용이 얼마예요", "인증 가격", "인증 심사 비용", "인증 비용 안내"],
    answer: [
      `인증 비용은 인증 종류에 따라 다르며, 모든 금액은 부가세 별도입니다.`,
      `• 기본 인증(${BASIC_LIST}): 200만원 (${BASIC_COST_DETAIL})`,
      "• 시험분석을 제외한 인증(제로웨이스트, 업사이클, 클린뷰티): 150만원",
      "• 서류심사로 진행하는 인증: 산호초 보호 인증은 국내용 50만원, 해외용 500만원이며, 비건 인증은 국내용 50만원입니다(비건 해외용은 기본 인증 200만원).",
      "• Microplastic-free 인증: 300만원 (Plastic free와 별도의 인증)",
      "• 반려동물 인증 탈취제: 시험분석 150만원, 최종 비용 300만원",
      "• EPD 인증: 약 2,500만원 (EPD Global, International EPD)",
      "• ISO 인증: 조직의 직원 수에 따라 달라 별도 문의로 진행합니다.",
    ].join("\n"),
  },
  {
    cert_type: "common",
    category: "duration",
    question: "인증 소요기간은 얼마나 걸리나요?",
    variants: ["인증까지 얼마나 걸려요", "인증 기간", "인증 발급 기간", "인증 소요 기간 안내"],
    answer: [
      "인증 소요기간은 인증 종류에 따라 다릅니다.",
      `• 기본 인증(${BASIC_LIST}): 현장심사 이후 인증서 발급까지 4~6주`,
      "• 시험분석을 제외한 인증(제로웨이스트, 업사이클, 클린뷰티): 4~6주",
      "• 서류심사로 진행하는 인증: 산호초 보호 인증은 국내용 2~3주, 해외용 6~7주이며, 비건 인증은 국내용 2~3주입니다(비건 해외용은 기본 인증과 같이 현장심사 이후 4~6주).",
      "• EPD 인증: 1~2달 (LCA, EPD 보고서가 있는 경우)",
    ].join("\n"),
    note: "비건 해외용 기간은 '기본 인증' 기준(현장심사 이후 4~6주)을 적용했다. 고객 재확인 권장.",
  },
  {
    cert_type: "common",
    category: "cost",
    question: "기본 인증 비용은 어떤 항목으로 구성되나요?",
    variants: ["인증 비용 구성", "인증 비용에 뭐가 포함되나요", "기본 비용 내역"],
    answer: `기본 인증 비용은 200만원이며 ${VAT}, 신청 및 라이센스 비용 50만원, 현장심사 및 인증위원회 상정 비용 100만원, 시험분석 비용 50만원으로 구성됩니다.`,
  },
  {
    cert_type: "common",
    category: "cost",
    question: "기본 인증에는 어떤 인증이 포함되나요?",
    variants: ["기본 인증 범위", "200만원 인증이 어떤 것들인가요", "기본 인증 종류"],
    answer: `기본 인증은 ${BASIC_LIST}입니다. 비용은 200만원(부가세 별도)이며, 소요기간은 현장심사 이후 인증서 발급까지 4~6주입니다.`,
  },
  {
    cert_type: "common",
    category: "cost",
    question: "시험분석 비용이 달라지는 인증이 있나요?",
    variants: ["시험분석 비용이 다른 인증", "시험분석 비용 예외", "인증 비용이 더 비싼 경우"],
    answer: [
      "네, 시험분석 비용이 다르면 최종 비용도 달라집니다. (부가세 별도)",
      "• 반려동물 인증 탈취제: 시험분석 150만원, 최종 비용 300만원",
      "• Microplastic-free 인증: Plastic free(200만원)와 별도의 인증으로, 비용은 300만원",
    ].join("\n"),
    note: "최초 안내(시험분석 100만원·최종 250만원)와 2차 확인(300만원)이 달라 2차 확인값(300만원)을 반영했다. 고객 재확인 필요.",
  },
  {
    cert_type: "common",
    category: "cost",
    question: "ISO 인증 비용은 얼마인가요?",
    variants: ["ISO 인증 가격", "ISO 인증 얼마", "ISO 심사 비용", "ISO 인증 비용 문의"],
    answer: `ISO 인증 비용은 조직의 직원 수에 따라 달라져 별도 문의로 진행합니다. 예를 들어 ${ISO_EXAMPLE} ISO 14001 등 다른 ISO 인증도 인증마다 비용이 다릅니다. (부가세 별도, 위 금액은 참고용 예시이며 정확한 비용은 담당자에게 문의해 주세요.)`,
    note: "ISO 9001 예시 외 구간·다른 ISO 인증의 금액은 받지 못했다(원문 '..'). 금액 표가 오면 보완.",
  },
  // ── 인증별: 기존 ─────────────────────────────────────────
  {
    cert_type: "vegan",
    category: "cost",
    question: "비건(Vegan) 인증 비용은 얼마인가요?",
    variants: ["비건인증 얼마", "비건 인증 가격", "비건 인증 심사 비용", "비건 해외용 비용"],
    answer: "비건 인증은 국내용과 해외용이 있으며 인증마크가 다릅니다. 국내용은 서류심사로 진행하며 50만원, 해외용(기본 비건)은 200만원입니다. (부가세 별도)",
  },
  {
    cert_type: "vegan",
    category: "duration",
    question: "비건(Vegan) 인증은 소요기간이 얼마나 걸리나요?",
    variants: ["비건인증 기간", "비건 인증 얼마나 걸려요", "비건 인증 소요 기간"],
    answer: "비건 인증의 소요기간은 국내용(서류심사)이 2~3주이며, 해외용(기본 비건)은 현장심사 이후 인증서 발급까지 4~6주입니다.",
    note: "해외용 기간은 '기본 인증' 기준을 적용했다. 고객 재확인 권장.",
  },
  {
    cert_type: "coral-reef-friendly",
    category: "cost",
    question: "산호초 보호(Coral Reef-friendly) 인증 비용은 얼마인가요?",
    variants: ["산호초 보호 인증 얼마", "산호초 인증 가격", "산호초 보호 인증 심사 비용"],
    answer: "산호초 보호 인증은 서류심사로 진행하며, 비용은 국내용 50만원, 해외용 500만원입니다. (부가세 별도)",
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
    answer: "제로웨이스트 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다. (부가세 별도)",
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
    answer: "업사이클 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다. (부가세 별도)",
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
    answer: "클린뷰티 인증은 시험분석을 제외한 인증으로, 비용은 150만원입니다. (부가세 별도)",
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
    answer: "EPD 인증 비용은 약 2,500만원입니다. (EPD Global, International EPD, 부가세 별도)",
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
    answer: "반려동물 인증 탈취제는 시험분석 비용이 150만원이며, 최종 비용은 300만원입니다. (부가세 별도)",
  },
  // ── 새로 추가 ──────────────────────────────────────────
  {
    cert_type: "iso-9001",
    category: "cost",
    question: "ISO 9001(품질경영시스템) 인증 비용은 얼마인가요?",
    variants: ["ISO9001 비용", "ISO 9001 인증 얼마", "품질경영시스템 인증 가격"],
    answer: `ISO 9001 인증 비용은 조직의 직원 수에 따라 달라져 별도 문의로 진행합니다. 예시로 직원 10명 190만원, 50명 400만원, 100명 540만원입니다. (부가세 별도, 참고용 예시이며 정확한 비용은 담당자에게 문의해 주세요.)`,
    note: "고객 제공 예시 3구간. 그 외 구간은 별도 문의.",
  },
  {
    cert_type: "microplastic-free",
    category: "cost",
    question: "미세플라스틱 프리(Microplastic-free) 인증 비용은 얼마인가요?",
    variants: ["미세플라스틱 인증 얼마", "Microplastic-free 인증 비용", "미세플라스틱 프리 가격"],
    answer: "Microplastic-free 인증은 Plastic free와 별도의 인증이며, 비용은 300만원입니다. (Plastic free는 200만원, 부가세 별도)",
    note: "최초 안내(시험분석 100만원·최종 250만원)와 2차 확인(300만원)이 달라 2차 확인값을 반영했다. 고객 재확인 필요.",
  },
  ...basicItems,
];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: existing, error } = await db.from("faq").select("*").like("draft_note", "[고객 제공 2026-10-07]%");
  if (error) throw error;
  const key = (r: { cert_type: string; category: string; question: string }) => `${r.cert_type}|${r.category}|${r.question}`;
  const byKey = new Map((existing ?? []).map((r) => [key(r), r]));
  const toUpdate = ITEMS.filter((i) => byKey.has(key(i)));
  const toInsert = ITEMS.filter((i) => !byKey.has(key(i)));
  const orphans = (existing ?? []).filter((r) => !ITEMS.some((i) => key(i) === key(r)));
  const { data: ct } = await db.from("cert_types").select("code").eq("code", "microplastic-free");

  console.log(`[cost-duration-2] 기존 고객 제공 FAQ ${existing?.length ?? 0}건 → 내용 갱신 ${toUpdate.length}건(초안으로 되돌림), 새로 등록 ${toInsert.length}건`);
  if (orphans.length) console.log(`  (대응 항목 없는 기존 FAQ ${orphans.length}건은 건드리지 않음)`);
  console.log(`[cost-duration-2] 인증 종류 microplastic-free: ${ct?.length ? "이미 있음" : "새로 등록"}`);
  for (const i of toInsert) console.log(`  + [${i.cert_type}/${i.category}] ${i.question}`);
  if (!apply) {
    console.log("\n미리보기입니다. 실행하려면 --apply");
    return;
  }

  await mkdir("data/backup", { recursive: true });
  const file = `data/backup/faq-cost-duration-before-update-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  await writeFile(file, JSON.stringify(existing ?? [], null, 1), "utf8");
  console.log(`[cost-duration-2] 백업 저장: ${file}`);

  if (!ct?.length) {
    const { error: e0 } = await db.from("cert_types").insert({ code: "microplastic-free", name_ko: "미세플라스틱 프리(Microplastic-free)", name_en: "Microplastic-free", category: "지속가능성", is_active: true, sort_order: 0 });
    if (e0) throw e0;
    console.log("[cost-duration-2] 인증 종류 등록: microplastic-free");
  }

  for (const i of toUpdate) {
    const row = byKey.get(key(i))!;
    const { error: e1 } = await db
      .from("faq")
      .update({
        answer: i.answer,
        variants: i.variants,
        status: "draft",
        needs_input: false,
        approved_by: null,
        approved_at: null,
        draft_note: i.note ? `${NOTE} ${i.note}` : NOTE,
      })
      .eq("id", row.id);
    if (e1) throw e1;
  }
  console.log(`[cost-duration-2] 갱신(초안으로 되돌림): ${toUpdate.length}건`);

  if (toInsert.length) {
    const rows = toInsert.map((i) => ({
      cert_type: i.cert_type,
      category: i.category,
      question: i.question,
      variants: i.variants,
      answer: i.answer,
      status: "draft",
      needs_input: false,
      lang: "ko",
      source_url: null,
      draft_note: i.note ? `${NOTE} ${i.note}` : NOTE,
    }));
    const { data, error: e2 } = await db.from("faq").insert(rows).select("id");
    if (e2) throw e2;
    console.log(`[cost-duration-2] 새 초안 등록: ${data?.length ?? 0}건`);
  }
}

main().catch((err) => {
  console.error("[cost-duration-2] 실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
