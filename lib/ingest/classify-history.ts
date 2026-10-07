/**
 * data/cert-history-raw.json 의 제품명 → 일반 제품 유형(브랜드 제외) 분류.
 * 실행: npm run ingest:history:types
 * 출력: data/cert-history-types.json  { "<인증번호>": "유형" }   (검수 후 load-history 가 사용)
 * 입력 파일은 기본 data/cert-history-raw.json. 다른 파일을 쓰려면 첫 인자로 경로를 준다
 * (예: data/cert-history-merged.json = 사이트 수집 + 고객 인증현황 엑셀).
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HISTORY_TYPE_SYSTEM } from "../prompts/history-type";
import type { RawCert } from "./crawl-history";

config({ path: ".env.local" });

const MODEL = process.env.HISTORY_TYPE_MODEL ?? "claude-sonnet-5-5";
const BATCH = 40;

async function main() {
  const raw: RawCert[] = JSON.parse(await readFile(path.resolve(process.argv[2] ?? path.join("data", "cert-history-raw.json")), "utf8"));
  const client = new Anthropic();
  const out: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += BATCH) {
    const chunk = raw.slice(i, i + BATCH);
    const list = chunk.map((r, j) => `${j + 1}. ${r.scheme || "(미상)"} | ${r.product}`).join("\n");
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: HISTORY_TYPE_SYSTEM,
      messages: [{ role: "user", content: list }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.includes("[")) throw new Error(`응답 형식 오류 stop=${res.stop_reason}: ${text.slice(0, 200)}`);
    if (res.stop_reason !== "end_turn") throw new Error(`중단 stop=${res.stop_reason}: ${text.slice(-200)}`);
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as { n: number; type: string }[];
    for (const { n, type } of arr) if (chunk[n - 1]) out[chunk[n - 1].cert_no] = String(type).trim();
    console.log(`[types] ${Math.min(i + BATCH, raw.length)}/${raw.length}`);
  }
  await writeFile(path.join(process.cwd(), "data", "cert-history-types.json"), JSON.stringify(out, null, 2), "utf8");
  console.log(`[types] 완료: ${Object.keys(out).length}건`);
}

main().catch((err) => {
  console.error("[types] 실패:", err);
  process.exit(1);
});
