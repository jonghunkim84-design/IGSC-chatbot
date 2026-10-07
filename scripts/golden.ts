/**
 * 대표 질문 회귀 테스트: 실제 모델·실제 승인 FAQ 로 runChat 을 돌려 결과를 판정한다. (DB 쓰기 없음: chat_log·미답변은 메모리로 대체)
 * 실행: npm run golden [-- --safety] [-- --filter F0] [-- --repeat 3] [-- --out docs/golden-report.md]
 *   --safety   FAQ 와 무관한 안전 규칙 케이스만 (승인 FAQ 가 0건이어도 통과해야 함)
 *   --filter   id 또는 질문에 이 글자가 들어간 케이스만
 *   --repeat N 각 케이스를 N번 실행 (모델 답이 흔들리는 케이스를 찾을 때). 한 번이라도 실패하면 실패, 일부만 실패하면 "흔들림" 표시
 *   --out      결과를 마크다운 파일로 저장
 * 종료 코드: 실패가 있으면 1
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { runChat, type ChatRoute } from "@/lib/chat/run-chat";
import { searchFaq, type FaqMatch } from "@/lib/search";
import { ensureCertNames } from "@/lib/cert-registry";
import * as messages from "@/lib/prompts/messages";
import { classifyQuestion } from "@/lib/chat/classify";
import { GOLDEN, type GoldenCase } from "../tests/golden/cases";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const REPEAT = Math.max(1, Number(opt("repeat")) || 1);
const CONCURRENCY = 3;

/** 숫자 불변식: 답변의 숫자는 근거 FAQ(또는 연락처·질문)에 있는 것만 허용한다. 비용·기간을 지어내지 않는다는 규칙의 기계 검사. */
const digitTokens = (s: string) => new Set(s.match(/\d+/g) ?? []);
/** 고정 문구(연락처, ISO 17065 등)의 숫자는 항상 허용한다 */
const FIXED_TEXT = Object.values(messages).filter((v): v is string => typeof v === "string").join(" ");

interface RunResult {
  route: ChatRoute;
  text: string;
  matches: FaqMatch[];
  failures: string[];
}

async function runOne(c: GoldenCase): Promise<RunResult> {
  let matches: FaqMatch[] = [];
  let route: ChatRoute = "handoff";
  let text = "";
  const gen = runChat(
    { message: c.q, previousQuestion: c.previousQuestion, certType: c.certType },
    {
      search: async (q, certType) => (matches = await searchFaq(q, certType)),
      logChat: async () => ({ id: "golden" }),
      logUnanswered: async () => undefined,
    },
  );
  for await (const ev of gen) {
    if (ev.type === "meta") route = ev.route;
    if (ev.type === "delta") text += ev.text;
  }

  const failures: string[] = [];
  if (!c.routes.includes(route)) failures.push(`경로 ${route} (허용: ${c.routes.join("/")})`);
  if (route === "answered") {
    if (c.faq && !matches.some((m) => c.faq!.test(m.question))) {
      failures.push(`근거 FAQ 불일치 (기대 ${c.faq}) — 선택됨: ${matches.map((m) => m.question).join(" | ") || "없음"}`);
    }
    if (matches.length === 0) failures.push("근거 FAQ 없이 answered");
  }
  for (const s of c.mustInclude ?? []) if (!(typeof s === "string" ? text.includes(s) : s.test(text))) failures.push(`있어야 할 말 없음: ${s}`);
  for (const s of c.mustNot ?? []) if (typeof s === "string" ? text.includes(s) : s.test(text)) failures.push(`나오면 안 되는 말: ${s}`);
  const allowed = digitTokens(
    `${FIXED_TEXT} ${matches.map((m) => `${m.question} ${m.answer} ${m.source_url ?? ""}`).join(" ")} ${c.q} ${c.previousQuestion ?? ""}`,
  );
  // 연도(20xx)는 답변 뒤에 붙는 '유사 인증 이력' 안내(DB 값)에 나오므로 제외한다
  const invented = [...digitTokens(text)].filter((d) => !allowed.has(d) && !/^(19|20)\d\d$/.test(d));
  if (invented.length) failures.push(`근거에 없는 숫자: ${invented.join(", ")}`);
  return { route, text, matches, failures };
}

/** API 오류(크레딧 소진·키 오류 등)가 '담당자 이관' 실패로 섞여 보이지 않도록 먼저 모델 호출이 되는지 확인한다. */
async function preflight() {
  try {
    await classifyQuestion("인증 절차가 어떻게 되나요?");
  } catch (err) {
    console.error(`모델 호출 실패: ${(err as Error).message}
API 키·크레딧을 확인한 뒤 다시 실행하세요. (이 상태에서는 챗봇도 모든 질문을 담당자 이관으로 처리합니다)`);
    process.exit(2);
  }
}

async function main() {
  await preflight();
  await ensureCertNames();
  let cases = GOLDEN.filter((c) => !flag("safety") || c.tag === "safety");
  const f = opt("filter");
  if (f) cases = cases.filter((c) => c.id.includes(f) || c.q.includes(f));
  console.log(`대표 질문 ${cases.length}건 × ${REPEAT}회 실행 (실제 모델 호출)\n`);

  const results: { c: GoldenCase; runs: RunResult[] }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        const runs: RunResult[] = [];
        for (let i = 0; i < REPEAT; i++) {
          try {
            runs.push(await runOne(c));
          } catch (err) {
            runs.push({ route: "handoff", text: "", matches: [], failures: [`실행 오류: ${(err as Error).message}`] });
          }
        }
        results.push({ c, runs });
      }
    }),
  );
  results.sort((a, b) => a.c.id.localeCompare(b.c.id));

  const lines: string[] = [];
  let failed = 0;
  let flaky = 0;
  for (const { c, runs } of results) {
    const bad = runs.filter((r) => r.failures.length);
    const status = bad.length === 0 ? "PASS" : bad.length === runs.length ? "FAIL" : "FLAKY";
    if (status === "FAIL") failed++;
    if (status === "FLAKY") flaky++;
    const head = `${status.padEnd(5)} ${c.id} [${runs.map((r) => r.route).join(",")}] ${c.q}${status === "FLAKY" ? `  (${bad.length}/${runs.length} 실패)` : ""}`;
    console.log(head);
    lines.push(`- ${head}`);
    if (bad.length) {
      const r = bad[0];
      for (const m of r.failures) {
        console.log(`        · ${m}`);
        lines.push(`  - ${m}`);
      }
      console.log(`        응답: ${r.text.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  const total = results.length;
  const summary = `\n합계 ${total}건: 통과 ${total - failed - flaky}, 실패 ${failed}, 흔들림 ${flaky}`;
  console.log(summary);
  const out = opt("out");
  if (out) {
    writeFileSync(out, `# 대표 질문 회귀 결과 (${new Date().toISOString()})\n${summary}\n\n${lines.join("\n")}\n`, "utf8");
    console.log(`저장: ${out}`);
  }
  process.exit(failed || flaky ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
