/**
 * 고객 Q&A 문서(data/inquiry/docx-qa.json) ↔ 기존 FAQ(DB, 읽기 전용) 겹침·충돌 비교.
 * 실행: npx tsx scripts/compare-docx-faq.ts   → data/inquiry/faq-overlap.json
 * DB에는 쓰지 않는다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { FAQ_CANDIDATE_SYSTEM, FAQ_COMPARE_SYSTEM } from "../lib/prompts/faq-compare";
import { certName } from "../lib/cert-names";

config({ path: ".env.local" });
const MODEL = "claude-sonnet-5-5";
const parseArr = (t: string) => JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));

async function main() {
  const qa: { no: number; q: string; a: string }[] = JSON.parse(await readFile("data/inquiry/docx-qa.json", "utf8"));
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const faqs: { id: string; question: string; answer: string; cert_type: string; status: string; needs_input: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("faq").select("id,question,answer,cert_type,status,needs_input").range(from, from + 999);
    if (error) throw error;
    faqs.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`[compare] 기존 FAQ ${faqs.length}건, 문서 Q ${qa.length}건`);
  const list = faqs.map((f, i) => `${i + 1}. [${certName(f.cert_type)}] ${f.question}`).join("\n");
  const ai = new Anthropic();
  const ask = async (system: unknown, user: string) => {
    const res = await ai.messages.create({ model: MODEL, max_tokens: 3000, system: system as never, messages: [{ role: "user", content: user }] });
    if (res.stop_reason !== "end_turn") throw new Error(`중단 ${res.stop_reason}`);
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  };

  const out = [];
  for (const item of qa) {
    const cand: number[] = parseArr(
      await ask(
        [{ type: "text", text: FAQ_CANDIDATE_SYSTEM }, { type: "text", text: `기존 FAQ 질문 목록:\n${list}`, cache_control: { type: "ephemeral" } }],
        `고객 문서 질문:\n${item.q}`,
      ),
    ).filter((n: number) => faqs[n - 1]);
    let verdicts: { n: number; relation: string; note: string }[] = [];
    if (cand.length) {
      const block = cand.map((n) => `#${n} 질문: ${faqs[n - 1].question}\n답변: ${faqs[n - 1].answer.slice(0, 900)}`).join("\n\n");
      verdicts = parseArr(await ask(FAQ_COMPARE_SYSTEM, `고객 문서 Q: ${item.q}\n고객 문서 A: ${item.a}\n\n기존 FAQ 후보:\n${block}`));
    }
    out.push({
      no: item.no, q: item.q, a: item.a,
      matches: verdicts.filter((v) => faqs[v.n - 1]).map((v) => ({ ...v, id: faqs[v.n - 1].id, question: faqs[v.n - 1].question, status: faqs[v.n - 1].status, cert: faqs[v.n - 1].cert_type, needs_input: faqs[v.n - 1].needs_input })),
    });
    console.log(`[compare] Q${item.no} 후보 ${cand.length}`);
  }
  await writeFile("data/inquiry/faq-overlap.json", JSON.stringify(out, null, 1), "utf8");
}
main().catch((e) => { console.error(e); process.exit(1); });
