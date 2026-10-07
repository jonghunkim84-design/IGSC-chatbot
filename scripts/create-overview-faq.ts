/**
 * "귀사는 어떤 종류의 인증을 하나요?" 개요 FAQ 초안 1건 등록 (status='draft', 승인은 담당자).
 * 답변은 이미 승인된 FAQ(회사 소개, 분야별 인증 목록, ISO, EPD·PHD·발자국, 반려동물)의 문구를 그대로 모아 만든다.
 *   npx tsx --conditions react-server scripts/create-overview-faq.ts            미리보기
 *   npx tsx --conditions react-server scripts/create-overview-faq.ts --apply    초안으로 등록
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { findSimilarFaq } from "@/lib/docs/similar-faq";

config({ path: ".env.local" });

const QUESTION = "귀사는 어떤 종류의 인증을 하나요?";
const VARIANTS = ["어떤 인증을 받을 수 있나요?", "제공하는 인증 종류를 알려주세요", "IGSC가 하는 인증 종류는 무엇인가요?", "어떤 종류의 인증을 하는지 알려주세요", "어떤 인증 서비스를 제공하나요?"];

/** 답변을 구성하는 승인된 FAQ(질문 일부)와, 그 답변에서 그대로 가져올 문구 추출 방법 */
const PARTS: { like: string; section: string | null; pick: (answer: string) => string }[] = [
  { like: "%어떤 회사이며%", section: null, pick: (a) => a.trim() },
  { like: "%식품 분야에서 인증받을 수 있는%", section: "식품", pick: (a) => a.replace(/^식품 분야 인증 항목으로\s*/, "").replace(/가 안내되어 있습니다\.?$/, "").trim() },
  { like: "%IGSC에서 화장품 분야로 받을 수 있는%", section: "화장품", pick: (a) => a.replace(/\s*\n\s*/g, " ").trim() },
  { like: "%IGSC에서 지속가능성 분야로 받을 수 있는%", section: "지속가능성", pick: (a) => a.replace(/\s*\n\s*/g, " ").trim() },
  { like: "%어떤 ISO 인증을 진행할 수 있나요%", section: "ISO 경영시스템", pick: (a) => a.replace(/\s*\n\s*/g, " ").trim() },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const evidence: string[] = [];
  const lines: string[] = [];
  for (const p of PARTS) {
    const { data } = await db.from("faq").select("question,answer").eq("status", "approved").ilike("question", p.like).limit(1);
    const f = data?.[0];
    if (!f) throw new Error(`근거가 되는 승인된 FAQ를 찾지 못했습니다: ${p.like}`);
    const text = p.pick(f.answer);
    evidence.push(f.answer.trim());
    lines.push(p.section ? `■ ${p.section}: ${text}` : text);
  }
  // 환경·검증 / 반려동물: 승인된 FAQ 제목과 답변 문구에서 확인되는 이름만 쓴다
  const check = async (like: string) => (await db.from("faq").select("answer").eq("status", "approved").ilike("question", like).limit(1)).data?.[0]?.answer;
  const epd = await check("%환경성적표지(EPD) 인증은 무엇%");
  const phd = await check("%제품건강선언(PHD) 인증이란%");
  const fp = await check("%EPD 및 탄소/물 발자국 서비스%");
  const petP = await check("%반려동물 관련 제품(Pet Related Product) 인증은 어떤%");
  const petS = await check("%반려동물 관련 서비스(Pet Related Service) 인증은 어떤%");
  if (!epd || !phd || !fp || !petP || !petS) throw new Error("환경·검증 또는 반려동물 근거 FAQ가 없습니다.");
  evidence.push(epd.trim(), phd.trim(), fp.split("\n")[0].trim(), petP.trim(), petS.trim());
  const middle = [
    "■ 환경 및 건강: 환경성적표지(EPD), 제품건강선언(PHD), 탄소발자국, 탄소저감, 탄소중립 서비스",
    "■ 반려동물: 반려동물 관련 제품(Pet Related Product) 인증, 반려동물 관련 서비스(Pet Related Service) 인증",
  ];
  const answer = [lines[0], "", "분야별로 안내된 인증은 다음과 같습니다.", ...lines.slice(1, 4), ...middle, lines[4]].join("\n");
  console.log("--- 답변 미리보기 ---\n" + answer + "\n---");

  const similar = await findSimilarFaq(QUESTION, "common");
  console.log("유사 FAQ:", similar.map((s) => `${s.status} ${s.question}`));
  if (!apply) return console.log("미리보기입니다. 등록하려면 --apply");
  if (similar.some((s) => s.question.replace(/\s/g, "") === QUESTION.replace(/\s/g, ""))) throw new Error("같은 질문이 이미 있습니다.");

  const { data, error } = await db
    .from("faq")
    .insert({
      question: QUESTION,
      variants: VARIANTS,
      answer,
      cert_type: "common",
      category: "scope",
      source_url: "https://igsc.kr/certification",
      lang: "ko",
      status: "draft",
      needs_input: false,
      source_evidence: evidence,
      draft_note: "[개요 FAQ] 이미 승인된 FAQ(회사 소개, 식품·화장품·지속가능성 분야 인증 목록, ISO, EPD·PHD·발자국, 반려동물)의 문구를 그대로 모아 만든 초안입니다. 승인 전에 분야 구분과 빠진 분야가 없는지 확인하세요.",
    })
    .select("id")
    .single();
  if (error) throw error;
  console.log("초안 등록 완료:", data.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
