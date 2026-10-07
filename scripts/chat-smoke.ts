/**
 * POST /api/chat 을 실제로 호출해 응답 전문, SSE route, chat_log/unanswered 기록을 출력한다.
 * 실행: (dev 서버 실행 중) npm run smoke:chat [-- "질문1" "질문2" ...]
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.CHAT_BASE_URL ?? "http://localhost:3000";
const DEFAULT_CASES: [string, string][] = [
  ["비건 인증 절차가 어떻게 되나요?", "answered"],
  ["우리 화장품이 비건 기준 통과하려면 뭘 고쳐야 하나요?", "consulting_blocked"],
  ["심사 결과에 이의가 있습니다", "complaint"],
  ["오늘 날씨 어때?", "out_of_scope"],
  ["고체 탈취제도 반려동물 인증 되나요?", "handoff (또는 이력 안내)"],
  ["탄소중립 인증은 얼마인가요?", "handoff"],
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function call(message: string) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const raw = await res.text();
  let meta: { sessionId: string; route: string; sources: string[] } | null = null;
  let text = "";
  let deltas = 0;
  for (const block of raw.split("\n\n")) {
    const ev = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim());
    if (!ev) continue;
    const data = JSON.parse(ev[2]);
    if (ev[1] === "meta") meta = data;
    if (ev[1] === "delta") {
      text += data.text;
      deltas++;
    }
  }
  return { status: res.status, meta, text, deltas };
}

async function main() {
  const args = process.argv.slice(2);
  const cases: [string, string][] = args.length ? args.map((q) => [q, "-"]) : DEFAULT_CASES;
  for (const [q, expected] of cases) {
    const r = await call(q);
    const { data: logs } = await sb.from("chat_log").select("id, route, matched_faq_ids").eq("session_id", r.meta?.sessionId ?? "");
    const log = logs?.[0];
    const { data: un } = log ? await sb.from("unanswered").select("id").eq("chat_log_id", log.id) : { data: [] };
    console.log("=".repeat(78));
    console.log(`질문: ${q}`);
    console.log(`기대: ${expected}`);
    console.log(`HTTP ${r.status} | SSE route: ${r.meta?.route} | delta ${r.deltas}회 | sources: ${r.meta?.sources.length ?? 0}`);
    console.log(`chat_log route: ${log ? log.route : "(기록 없음)"} | matched_faq_ids: ${log?.matched_faq_ids?.length ?? 0} | unanswered: ${un?.length ?? 0}건`);
    console.log("--- 응답 전문 ---");
    console.log(r.text);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
