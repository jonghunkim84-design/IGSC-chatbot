/**
 * 문서 보관함의 PPTX 문서(추출된 doc_chunks) → FAQ 초안 생성·등록.
 *   npx tsx scripts/draft-pptx-faqs.ts "<파일명>" [...]          미리보기 (DB에 쓰지 않음)
 *   npx tsx scripts/draft-pptx-faqs.ts "<파일명>" [...] --apply   초안(draft)으로 등록
 * 답변은 원문 문장을 그대로 인용하고, 모든 줄이 문서 텍스트에 있는지·숫자가 원문에 있는지 코드로 검증한다.
 * 등록한 id 는 data/inquiry/pptx-faqs-loaded.json (되돌리기용).
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { writeFile } from "node:fs/promises";
import { DOC_FAQ_SYSTEM } from "../lib/prompts/doc-intro-faq";
import { CERT_NAMES, certName } from "../lib/cert-names";

config({ path: ".env.local" });
const CATS = new Set(["procedure", "document", "scope", "renewal"]);
const norm = (s: string) => s.replace(/[\s\-•·*()（）\[\]/,.:;"'“”‘’!?~▶]/g, "").toLowerCase();

async function main() {
  const apply = process.argv.includes("--apply");
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!names.length) throw new Error("파일명을 지정하세요.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: faqs } = await db.from("faq").select("question,cert_type");
  const existing = (faqs ?? []).map((f, i) => `${i + 1}. [${certName(f.cert_type)}] ${f.question}`).join("\n");
  const haveQ = new Set((faqs ?? []).map((f) => f.question));
  const ai = new Anthropic();
  const rows: Record<string, unknown>[] = [];

  for (const name of names) {
    const { data: docs } = await db.from("documents").select("id,file_name,status,version").eq("file_name", name).neq("status", "archived").order("version", { ascending: false });
    const doc = docs?.[0];
    if (!doc) throw new Error(`문서 보관함에 없는 파일(또는 보관 처리됨): ${name}`);
    const { data: ch } = await db.from("doc_chunks").select("page_no,content").eq("document_id", doc.id).order("chunk_index");
    const src = ch!.map((c) => `[p.${c.page_no}]\n${c.content}`).join("\n\n");
    const res = await ai.messages.create({
      model: "claude-sonnet-5-5", max_tokens: 8000,
      system: [{ type: "text", text: DOC_FAQ_SYSTEM }, { type: "text", text: `기존 FAQ 목록(중복 방지용):\n${existing}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `문서 파일명: ${name}\n\n${src}` }],
    });
    if (res.stop_reason !== "end_turn") throw new Error(`중단 ${name}`);
    const t = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const arr: { question: string; cert: string; category: string; page?: number; answer_lines?: string[] }[] = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
    const ns = norm(src);
    const srcNums = new Set(src.match(/\d+(?:[.,]\d+)?/g) ?? []);
    let kept = 0;
    for (const a of arr) {
      const lines = (a.answer_lines ?? []).map((l) => String(l).trim()).filter(Boolean);
      const badLine = lines.find((l) => norm(l).length >= 4 && !ns.includes(norm(l)));
      const badNum = lines.join(" ").match(/\d+(?:[.,]\d+)?/g)?.find((n) => !srcNums.has(n));
      const costy = /수수료|비용|견적|금액/.test(lines.join(" "));
      const certOk = a.cert === "common" || a.cert in CERT_NAMES;
      if (!lines.length || badLine || badNum || costy || !certOk || !CATS.has(a.category) || haveQ.has(a.question.trim())) {
        console.log(`  [제외] ${a.question} ← ${badLine ?? badNum ?? (costy ? "비용 문구 포함" : haveQ.has(a.question.trim()) ? "이미 있는 질문" : "형식")}`);
        continue;
      }
      kept++;
      rows.push({
        question: a.question.trim(), variants: [], answer: lines.join("\n"), cert_type: a.cert, category: a.category,
        source_url: null, lang: "ko", status: "draft", needs_input: false, source_doc_id: doc.id, source_page: a.page ?? null,
        source_evidence: lines, draft_note: `[PPTX 자료] ${name}${a.page ? ` p.${a.page}` : ""} — 원문 문장 인용`,
      });
    }
    console.log(`[pptx-faq] ${name}: 후보 ${arr.length} → 채택 ${kept}`);
  }
  for (const r of rows) console.log(`  + [${r.cert_type}/${r.category}] (p${r.source_page}) ${r.question}\n      ${String(r.answer).slice(0, 110).replace(/\n/g, " / ")}`);
  if (!apply) return console.log(`[pptx-faq] 미리보기 ${rows.length}건. 등록하려면 --apply`);
  const { data, error } = await db.from("faq").insert(rows).select("id");
  if (error) throw error;
  await writeFile("data/inquiry/pptx-faqs-loaded.json", JSON.stringify(data!.map((r) => r.id), null, 1), "utf8");
  console.log(`[pptx-faq] 등록 완료 ${data!.length}건 → data/inquiry/pptx-faqs-loaded.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
