/**
 * docs/test-scenarios.md 의 TC를 POST /api/chat 으로 검증한다 (TC-09는 관리자 화면 이후라 제외).
 * 실행: (dev 서버 실행 중) npm run verify:tc
 *
 * 판정: PASS = 동작이 기대와 일치 / DATA = 동작은 맞지만 시나리오가 요구하는 데이터(승인 FAQ·이력)가 아직 없음 / FAIL = 동작 불일치
 * chat_log route 가 남지 않으면 WARN (supabase/migrations/0002 미적용 가능성)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import {
  MSG_CLARIFY_CERT,
  MSG_CONSULTING_BLOCKED,
  MSG_LANGUAGE_UNSUPPORTED,
  MSG_OUT_OF_SCOPE,
} from "@/lib/prompts/messages";

const BASE = process.env.CHAT_BASE_URL ?? "http://localhost:3000";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

interface Res {
  route: string;
  text: string;
  sessionId: string;
  logRoute: string | null;
  unanswered: number;
}

async function call(body: Record<string, unknown>): Promise<Res> {
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const raw = await res.text();
  let route = "";
  let sessionId = "";
  let text = "";
  for (const block of raw.split("\n\n")) {
    const ev = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim());
    if (!ev) continue;
    const data = JSON.parse(ev[2]);
    if (ev[1] === "meta") ({ route, sessionId } = data);
    if (ev[1] === "delta") text += data.text;
  }
  const { data: logs } = await sb.from("chat_log").select("id, route").eq("session_id", sessionId);
  const log = logs?.[0];
  const { data: un } = log ? await sb.from("unanswered").select("id").eq("chat_log_id", log.id) : { data: [] };
  return { route, text, sessionId, logRoute: log?.route ?? null, unanswered: un?.length ?? 0 };
}

let failed = 0;
const results: string[] = [];
function report(tc: string, verdict: "PASS" | "DATA" | "FAIL", input: string, r: Res, note = "") {
  if (verdict === "FAIL") failed++;
  const warn = r.logRoute === null ? " ⚠ chat_log 미기록" : "";
  results.push(`${verdict.padEnd(4)} ${tc} | route=${r.route} log=${r.logRoute ?? "-"} unanswered=${r.unanswered}${warn}${note ? ` | ${note}` : ""}`);
  console.log("=".repeat(78));
  console.log(`${tc}  입력: ${input}`);
  console.log(`판정: ${verdict}${note ? ` — ${note}` : ""}`);
  console.log(`route=${r.route} | chat_log route=${r.logRoute ?? "(없음)"} | unanswered=${r.unanswered}건${warn}`);
  console.log("--- 응답 전문 ---");
  console.log(r.text);
}
const hasContact = (t: string) => t.includes("02-858-4321") && t.includes("igsc@igsc.kr");

async function main() {
  {
    const q = "비건 인증 비용이 얼마인가요?";
    const r = await call({ message: q });
    const ok = r.route === "handoff" && r.unanswered === 1 && hasContact(r.text) && !/\d+\s*원/.test(r.text);
    report("TC-01", ok ? "PASS" : "FAIL", q, r, "비용 FAQ가 needs_input(미승인)이라 담당자 안내 — 시나리오가 '현재는 needs_input이라 담당자 안내'로 명시");
  }
  {
    const q = "인증받는 데 얼마나 걸려요?";
    const r = await call({ message: q });
    report("TC-02", r.route === "clarify" && r.text === MSG_CLARIFY_CERT ? "PASS" : "FAIL", q, r, "인증 종류 되묻기");
    const q2 = "비건이요";
    const r2 = await call({ message: q2, previousQuestion: q });
    report("TC-02b", r2.route === "handoff" && r2.unanswered === 1 ? "DATA" : "FAIL", `${q2} (이전 질문: ${q})`, r2, "되묻기 후속: 표준 기간 FAQ가 미승인(needs_input)이라 담당자 안내. 기간 FAQ 승인 시 표준 기간 안내로 바뀜");
  }
  {
    const q = "고체 탈취제도 반려동물 인증 되나요?";
    const r = await call({ message: q });
    const noAffirm = !/가능합니다|되실 수 있습니다|받으실 수 있습니다|인증됩니다/.test(r.text);
    const ok = noAffirm && /담당자/.test(r.text) && (r.route === "handoff" || r.route === "answered");
    report("TC-03", ok ? "DATA" : "FAIL", q, r, "확답 없음+담당자 검토 안내는 충족. 유사 인증 이력 안내는 cert_history 데이터가 없어 불가");
  }
  {
    const q = "필요한 서류 알려주세요";
    const r = await call({ message: q });
    const ok = r.route === "clarify" || r.route === "handoff";
    report("TC-04", ok ? "DATA" : "FAIL", q, r, "인증별 서류 FAQ가 승인 목록에 없어 목록·출처 링크 제공 불가. 추측 없이 되묻기/이관 처리됨");
  }
  {
    const q = "우리 제품 어떻게 바꾸면 통과하나요?";
    const r = await call({ message: q });
    report("TC-05", r.route === "consulting_blocked" && r.text === MSG_CONSULTING_BLOCKED ? "PASS" : "FAIL", q, r, "고정 문구만 응답(방법론 없음)");
  }
  for (const q of ["FSC 인증은 얼마인가요?", "할랄 인증 절차가 궁금합니다"]) {
    const r = await call({ message: q });
    report("TC-06", r.route === "handoff" && r.unanswered === 1 && hasContact(r.text) ? "PASS" : "FAIL", q, r, "추측 없이 담당자 이관 + unanswered 적재");
  }
  {
    const q = "심사 결과가 부당합니다";
    const r = await call({ message: q });
    report("TC-07", r.route === "complaint" && hasContact(r.text) ? "PASS" : "FAIL", q, r, "AI 답변 없이 담당자 연결 안내");
  }
  {
    const q = "How much does vegan certification cost?";
    const r = await call({ message: q });
    report("TC-08", r.route === "handoff" && r.text === MSG_LANGUAGE_UNSUPPORTED && r.unanswered === 1 ? "PASS" : "FAIL", q, r, "대응 범위 밖 안내 + 담당자 연결");
  }
  {
    const q = "날씨 어때?";
    const r = await call({ message: q });
    report("TC-10", r.route === "out_of_scope" && r.text === MSG_OUT_OF_SCOPE ? "PASS" : "FAIL", q, r, "인증 문의 전용 안내");
  }

  console.log("\n" + "=".repeat(78) + "\n요약\n" + results.join("\n"));
  console.log(failed === 0 ? "\nFAIL 없음" : `\nFAIL ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
