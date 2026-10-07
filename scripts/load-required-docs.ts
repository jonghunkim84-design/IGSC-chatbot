/**
 * data/inquiry/required-docs-drafts.json (필요서류 PDF 초안) → faq 초안(draft) 등록.
 * 실행: npx tsx scripts/load-required-docs.ts [--apply]
 * - status 는 항상 'draft'. 출처 문서(documents.file_name)에 연결한다. 같은 문서·질문이 이미 있으면 건너뛴다.
 * - 등록한 id 는 data/inquiry/required-docs-loaded.json 에 기록한다 (되돌리기용).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

const nfc = (s: string) => s.normalize("NFC");
/** 원문이 잘려 있어 고객 확인이 필요한 파일 */
const FLAG: Record<string, string> = {
  "제품인증의 필요 서류-Sugar free, Calorie free포함v1.pdf": "원본 PDF 마지막 주석이 'Upcycled Materia'에서 끊겨 있음 — 고객에게 전체 문구 확인",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const drafts: { file: string; cert: string; category: string; question: string; answer: string; evidence: string[] }[] = JSON.parse(
    await readFile("data/inquiry/required-docs-drafts.json", "utf8"),
  );
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: docs, error } = await db.from("documents").select("id,file_name");
  if (error) throw error;
  const docId = new Map((docs ?? []).map((d) => [nfc(d.file_name), d.id as string]));
  const { data: have } = await db.from("faq").select("question,source_doc_id").not("source_doc_id", "is", null);
  const haveKey = new Set((have ?? []).map((r) => `${r.source_doc_id}|${r.question}`));

  const rows = [];
  for (const d of drafts) {
    const id = docId.get(nfc(d.file));
    if (!id) throw new Error(`문서 보관함에 없는 파일: ${d.file}`);
    if (haveKey.has(`${id}|${d.question}`)) continue;
    const flag = FLAG[d.file];
    rows.push({
      question: d.question, variants: [] as string[], answer: d.answer, cert_type: d.cert, category: d.category,
      source_url: null, lang: "ko", status: "draft" as const, needs_input: Boolean(flag),
      source_doc_id: id, source_page: 1, source_evidence: d.evidence,
      draft_note: `[필요서류 PDF] ${d.file}${flag ? ` / ${flag}` : ""}`,
    });
  }
  console.log(`[required-docs] 등록 대상 ${rows.length}건 (초안 ${drafts.length}건 중), 보완 필요 ${rows.filter((r) => r.needs_input).length}건`);
  if (!apply) return console.log("[required-docs] 미리보기입니다. 등록하려면 --apply");
  const { data, error: iErr } = await db.from("faq").insert(rows).select("id");
  if (iErr) throw iErr;
  await writeFile("data/inquiry/required-docs-loaded.json", JSON.stringify(data!.map((r) => r.id), null, 1), "utf8");
  console.log(`[required-docs] 등록 완료 ${data!.length}건 → data/inquiry/required-docs-loaded.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
