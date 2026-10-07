/**
 * 고객 Q&A 문서(data/inquiry/faq-overlap.json: 문서 질문·답변 + 기존 FAQ 대조 결과) → faq 초안(draft) 등록.
 * 실행: npx tsx scripts/load-docx-faq.ts            (미리보기)
 *       npx tsx scripts/load-docx-faq.ts --apply    (등록)
 *
 * - 고객 답변은 한 글자도 바꾸지 않고 그대로 저장한다 (AI 생성 없음). status 는 항상 'draft'.
 * - 충돌로 판정된 항목(Q53)은 제외한다. 신규·보완 항목만 등록.
 * - source_doc_id 로 문서에 연결하므로, 문서 개정판을 올리면 재검토 표시가 붙는다.
 * - 고객 확정이 필요한 항목(수치·모호한 표현·주소 오류)은 needs_input=true + draft_note 로 표시한다
 *   (보완 필요 항목은 일괄 승인 대상에서 빠진다).
 * - 등록한 id 는 data/inquiry/docx-drafts-loaded.json 에 기록한다 (되돌리기용).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

const DOC_LIKE = "%IGSC_261001.docx"; // 파일명에 &가 있어 eq 대신 like 사용
const EXCLUDE = new Set([53]); // 기존 승인 FAQ와 충돌 → 고객 결정 후 처리

const CATEGORY: Record<number, "procedure" | "cost" | "duration" | "document" | "scope" | "renewal"> = {
  16: "procedure", 20: "procedure", 24: "procedure", 25: "procedure", 26: "procedure", 31: "procedure", 32: "procedure",
  17: "document", 19: "document",
  30: "duration", 46: "duration",
  36: "cost", 37: "cost", 38: "cost", 39: "cost", 40: "cost", 45: "cost", 47: "cost",
  69: "renewal",
};

/** 고객 확인이 필요한 항목 → draft_note */
const FLAG: Record<number, string> = {
  13: "답변 끝에 '알려주시면 확인 후 답변'이라는 담당자 안내 문구가 있음 — FAQ 답변인지 이관 안내인지 확인",
  14: "원격/현장 심사 조건이 Q26과 함께 정리 필요 — 고객 확인",
  26: "'모든 인증 가능'과 '특수한 경우에만'이 한 답변에 섞여 있음 — 조건 확인",
  30: "기간 수치(보통 1일, ISO는 직원 수에 따라) — 고객 확정값 확인",
  45: "환불 불가 정책 — 표현과 예외 확인",
  46: "기간 수치(1달 이내) — 고객 확정값 확인",
  47: "비용 1.5배·급행 조건 — 고객 확정값 확인",
  50: "조회 주소가 중국어 경로(/zh/)로 적혀 있음 — 한국어 주소 확인 (원문은 수정하지 않음)",
};

interface Item {
  no: number; q: string; a: string;
  matches: { relation: string; question: string; status: string }[];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const items: Item[] = JSON.parse(await readFile("data/inquiry/faq-overlap.json", "utf8"));
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: doc, error: dErr } = await db.from("documents").select("id").ilike("file_name", DOC_LIKE).single();
  if (dErr) throw dErr;
  const { data: existing } = await db.from("faq").select("question").eq("source_doc_id", doc.id);
  const have = new Set((existing ?? []).map((r) => r.question));

  const rows = items
    .filter((x) => !EXCLUDE.has(x.no) && x.a.trim())
    .filter((x) => !have.has(x.q.trim()))
    .map((x) => {
      const overlap = x.matches.filter((m) => m.relation === "complement" || m.relation === "same" || m.relation === "conflict");
      const notes: string[] = [];
      if (FLAG[x.no]) notes.push(FLAG[x.no]);
      if (overlap.length) notes.push(`기존 FAQ와 겹침(승인은 한쪽만): ${[...new Set(overlap.map((m) => `「${m.question}」(${m.status === "approved" ? "승인" : "초안"})`))].join(", ")}`);
      return {
        question: x.q.trim(),
        variants: [] as string[],
        answer: x.a.trim(),
        cert_type: "common",
        category: CATEGORY[x.no] ?? "scope",
        source_url: null,
        lang: "ko",
        status: "draft" as const,
        needs_input: Boolean(FLAG[x.no]),
        source_doc_id: doc.id,
        source_page: null,
        source_evidence: [x.a.trim()],
        draft_note: notes.length ? `[고객 Q&A 문서 Q${x.no}] ${notes.join(" / ")}` : `[고객 Q&A 문서 Q${x.no}]`,
      };
    });

  const cats: Record<string, number> = {};
  for (const r of rows) cats[r.category] = (cats[r.category] ?? 0) + 1;
  console.log(`[docx-faq] 등록 대상 ${rows.length}건 (기등록 ${have.size}건 제외, 충돌 제외 ${[...EXCLUDE].join(",")})`, cats, `보완 필요 ${rows.filter((r) => r.needs_input).length}건`);
  if (!apply) return console.log("[docx-faq] 미리보기입니다. 등록하려면 --apply");

  const { data, error } = await db.from("faq").insert(rows).select("id");
  if (error) throw error;
  await writeFile("data/inquiry/docx-drafts-loaded.json", JSON.stringify(data!.map((d) => d.id), null, 1), "utf8");
  console.log(`[docx-faq] 등록 완료 ${data!.length}건 → data/inquiry/docx-drafts-loaded.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
