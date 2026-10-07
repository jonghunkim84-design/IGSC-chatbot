/**
 * data/inquiry/parsed.json (문의 이력 파싱본) → 주제·인증·적합도 분류 → data/inquiry/classified.json
 * 실행: npx tsx scripts/analyze-inquiries.ts
 * 개인정보 보호: 분류 결과에는 intent(요약)만 저장한다. 원문은 parsed.json 에만 있다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INQUIRY_ANALYSIS_SYSTEM } from "../lib/prompts/inquiry-analysis";

config({ path: ".env.local" });

interface Rec { year: string; date: string; kind: string; group: string; title: string; body: string }
const BATCH = 25;

async function main() {
  const recs: Rec[] = JSON.parse(await readFile(path.join("data", "inquiry", "parsed.json"), "utf8"));
  const items = recs.map((r, i) => ({ i, r })).filter((x) => x.r.body || x.r.title);
  const client = new Anthropic();
  const out: Record<number, unknown> = {};
  for (let s = 0; s < items.length; s += BATCH) {
    const chunk = items.slice(s, s + BATCH);
    const text = chunk.map((x, j) => `${j + 1}. [${x.r.kind || "-"}/${x.r.group || "-"}] ${x.r.title}\n${x.r.body.slice(0, 700)}`).join("\n\n");
    const res = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      system: INQUIRY_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    const t = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (res.stop_reason !== "end_turn") throw new Error(`중단 ${res.stop_reason}`);
    const arr = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1)) as { n: number }[];
    for (const a of arr) if (chunk[a.n - 1]) out[chunk[a.n - 1].i] = { year: chunk[a.n - 1].r.year, group: chunk[a.n - 1].r.group, ...a };
    console.log(`[inquiry] ${Math.min(s + BATCH, items.length)}/${items.length}`);
  }
  await writeFile(path.join("data", "inquiry", "classified.json"), JSON.stringify(Object.values(out), null, 1), "utf8");
  console.log(`[inquiry] 완료 ${Object.keys(out).length}건`);
}

main().catch((e) => { console.error(e); process.exit(1); });
