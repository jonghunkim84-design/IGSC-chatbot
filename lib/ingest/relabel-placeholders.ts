/**
 * 비용·기간 placeholder 질문의 영문 slug를 한글 인증명으로 교체한다 (재생성 없이).
 * 실행: npm run ingest:relabel
 * - 한글명은 lib/cert-names.ts (크롤링 원문의 페이지 제목 기준) 에서 가져온다. 매핑이 없으면 slug 그대로 + 경고 로그.
 * - id는 유지한다 → 이후 `npm run ingest:load` 로 DB의 같은 행이 업데이트된다.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { certName, hasCertName } from "../cert-names";
import { placeholderText } from "./cert-labels";
import { toCsv } from "./csv";
import type { DraftFaq } from "./generate-faq";

const DATA = path.join(process.cwd(), "data");

async function main() {
  const draft: DraftFaq[] = JSON.parse(await readFile(path.join(DATA, "faq-draft.json"), "utf8"));

  let changed = 0;
  const unmapped = new Set<string>();
  for (const it of draft) {
    if (!it.needs_input || (it.category !== "cost" && it.category !== "duration")) continue;
    const label = it.cert_type === "common" ? undefined : certName(it.cert_type);
    if (it.cert_type !== "common" && !hasCertName(it.cert_type)) unmapped.add(it.cert_type);
    const t = placeholderText(label, it.category);
    if (t.question !== it.question) changed++;
    it.question = t.question;
    it.variants = t.variants;
  }

  await writeFile(path.join(DATA, "faq-draft.json"), JSON.stringify(draft, null, 2), "utf8");
  try {
    await writeFile(path.join(DATA, "faq-draft.csv"), toCsv(draft), "utf8");
  } catch (err) {
    // Excel 등이 CSV를 열어 두면 쓰기가 막힌다 → 대체 파일로 저장
    await writeFile(path.join(DATA, "faq-draft.relabeled.csv"), toCsv(draft), "utf8");
    console.warn(`[relabel] faq-draft.csv 가 잠겨 있어 faq-draft.relabeled.csv 로 저장했습니다 (${(err as NodeJS.ErrnoException).code}).`);
  }

  console.log(`[relabel] placeholder ${changed}건 질문 변경`);
  console.log(`[relabel] 매핑되지 않은 slug (${unmapped.size}): ${[...unmapped].join(", ") || "없음"}`);
}

main().catch((err) => {
  console.error("[relabel] 실패:", err);
  process.exit(1);
});
