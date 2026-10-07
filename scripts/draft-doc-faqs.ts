/**
 * 절차·소개자료 PDF → FAQ 초안 미리보기 (DB에 쓰지 않음).
 * 실행: npx tsx scripts/draft-doc-faqs.ts → data/inquiry/doc-faq-drafts.json, docs/doc-faq-drafts.md
 * AI가 원문 문장을 인용해 답변 후보를 만들고, 모든 줄이 원문에 있는지·숫자가 원문에 있는지 코드로 검증한다.
 * 글자 깨짐이 심한 PDF(10% 초과)는 제외한다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { getDocumentProxy, extractText } from "unpdf";
import { DOC_FAQ_SYSTEM } from "../lib/prompts/doc-intro-faq";
import { CERT_NAMES, certName } from "../lib/cert-names";

config({ path: ".env.local" });
const ROOT = "docs/customer-files/IGSC AI 챗봇 구축 요청 서류_261002";
const FILES = [
  "3. 인증자료-인증절차, 필요서류/0. Certification Audit Process_2025.pdf",
  "3. 인증자료-인증절차, 필요서류/인증절차 안내_260511.pdf",
  "5. 소개자료/EPD 검증 서비스 소개자료_2024.pdf",
  "5. 소개자료/IGSC JAS 인증 소개자료_260722.pdf",
  "5. 소개자료/IGSC-소개자료_v2.2(251226).pdf",
  "5. 소개자료/국제지속가능인증원_COSMETICS_251226.pdf",
  "5. 소개자료/국제지속가능인증원_FOOD_251226.pdf",
  "5. 소개자료/국제지속가능인증원_비건인증 소개_26.v1.pdf",
  "5. 소개자료/국제지속가능인증원_지속가능인증 소개_26.pdf",
];
const CATS = new Set(["procedure", "document", "scope", "renewal"]);
const norm = (s: string) => s.replace(/[\s\-•·*()（）\[\]/,.:;"'“”‘’!?~]/g, "").toLowerCase();

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: faqs } = await db.from("faq").select("question,cert_type");
  const existing = (faqs ?? []).map((f, i) => `${i + 1}. [${certName(f.cert_type)}] ${f.question}`).join("\n");
  const ai = new Anthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (const rel of FILES) {
    const file = rel.split("/").pop()!;
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(`${ROOT}/${rel}`)));
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const src = (pages as string[]).map((t, i) => `[p.${i + 1}]\n${t}`).join("\n\n");
    const res = await ai.messages.create({
      model: "claude-sonnet-5-5", max_tokens: 12000,
      system: [{ type: "text", text: DOC_FAQ_SYSTEM }, { type: "text", text: `기존 FAQ 목록(중복 방지용):\n${existing}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `문서 파일명: ${file}\n\n${src}` }],
    });
    if (res.stop_reason !== "end_turn") throw new Error(`중단 ${file} ${res.stop_reason}`);
    const t = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
    const ns = norm(src);
    const srcNums = new Set(src.match(/\d+(?:[.,]\d+)?/g) ?? []);
    let kept = 0, dropped = 0;
    for (const a of arr) {
      const lines: string[] = (a.answer_lines ?? []).map((l: string) => String(l).trim()).filter(Boolean);
      const badLine = lines.find((l) => norm(l).length >= 4 && !ns.includes(norm(l)));
      const badNum = lines.join(" ").match(/\d+(?:[.,]\d+)?/g)?.find((n) => !srcNums.has(n));
      const certOk = a.cert === "common" || a.cert in CERT_NAMES;
      const ok = lines.length > 0 && !badLine && !badNum && certOk && CATS.has(a.category) && !/국국/.test(lines.join(""));
      if (!ok) { dropped++; console.log(`  [폐기] ${a.question} ← ${badLine ?? badNum ?? "형식"}`); continue; }
      kept++;
      out.push({ file, cert: a.cert, category: a.category, page: a.page ?? null, question: String(a.question).trim(), answer: lines.join("\n"), evidence: lines });
    }
    console.log(`[doc-faq] ${file}: 후보 ${arr.length} → 채택 ${kept}, 폐기 ${dropped}`);
  }
  await writeFile("data/inquiry/doc-faq-drafts.json", JSON.stringify(out, null, 1), "utf8");
  const md = [`# 절차·소개자료 PDF → FAQ 초안 미리보기 (${out.length}건)\n`, ...out.map((d, i) => `## ${i + 1}. ${d.question}\n- 인증: \`${d.cert}\` · 분류: ${d.category} · 출처: ${d.file} p.${d.page}\n\n${d.answer}\n`)].join("\n");
  await writeFile("docs/doc-faq-drafts.md", md, "utf8");
  console.log(`[doc-faq] 총 ${out.length}건`);
}
main().catch((e) => { console.error(e); process.exit(1); });
