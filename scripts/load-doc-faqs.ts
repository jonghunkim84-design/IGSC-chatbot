/**
 * data/inquiry/doc-faq-drafts.json (절차·소개자료 PDF 초안) → faq 초안(draft) 등록.
 * 실행: npx tsx scripts/load-doc-faqs.ts [--apply]
 * - status 는 항상 'draft'. 출처 문서(documents.file_name)에 연결. 같은 문서·질문이 이미 있으면 건너뛴다.
 * - 제외 파일: 현행 여부가 불분명한 10단계 절차 문서(고객 확인 전).
 * - 등록한 id 는 data/inquiry/doc-faqs-loaded.json (되돌리기용).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });
const nfc = (s: string) => s.normalize("NFC");
const EXCLUDE_FILES = new Set(["0. Certification Audit Process_2025.pdf"]);

async function main() {
  const apply = process.argv.includes("--apply");
  const drafts: { file: string; cert: string; category: string; page: number | null; question: string; answer: string; evidence: string[] }[] = JSON.parse(
    await readFile("data/inquiry/doc-faq-drafts.json", "utf8"),
  );
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: docs, error } = await db.from("documents").select("id,file_name");
  if (error) throw error;
  const docId = new Map((docs ?? []).map((d) => [nfc(d.file_name), d.id as string]));
  const { data: have } = await db.from("faq").select("question,source_doc_id").not("source_doc_id", "is", null);
  const haveKey = new Set((have ?? []).map((r) => `${r.source_doc_id}|${r.question}`));

  const rows = [];
  const missing = new Set<string>();
  for (const d of drafts) {
    if (EXCLUDE_FILES.has(d.file)) continue;
    const id = docId.get(nfc(d.file));
    if (!id) { missing.add(d.file); continue; }
    if (haveKey.has(`${id}|${d.question}`)) continue;
    rows.push({
      question: d.question, variants: [] as string[], answer: d.answer, cert_type: d.cert, category: d.category,
      source_url: null, lang: "ko", status: "draft" as const, needs_input: false,
      source_doc_id: id, source_page: d.page, source_evidence: d.evidence,
      draft_note: `[PDF 자료] ${d.file}${d.page ? ` p.${d.page}` : ""} — 원문 문장 인용`,
    });
  }
  if (missing.size) throw new Error(`문서 보관함에 없는 파일: ${[...missing].join(", ")}`);
  console.log(`[doc-faqs] 등록 대상 ${rows.length}건 (초안 ${drafts.length}건 중, 제외 파일 ${[...EXCLUDE_FILES].join(", ")})`);
  if (!apply) return console.log("[doc-faqs] 미리보기입니다. 등록하려면 --apply");
  const { data, error: iErr } = await db.from("faq").insert(rows).select("id");
  if (iErr) throw iErr;
  await writeFile("data/inquiry/doc-faqs-loaded.json", JSON.stringify(data!.map((r) => r.id), null, 1), "utf8");
  console.log(`[doc-faqs] 등록 완료 ${data!.length}건 → data/inquiry/doc-faqs-loaded.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
