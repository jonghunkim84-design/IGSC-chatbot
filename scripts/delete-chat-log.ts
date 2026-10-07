/**
 * 대화 기록(chat_log) 삭제. 기본은 미리보기(DB 쓰기 없음). 인계 전에 개발 테스트 기록을 비울 때 쓴다.
 *
 *   npx tsx scripts/delete-chat-log.ts 2026-10-04                미리보기: 이 날짜(한국시간 0시) 이전 기록
 *   npx tsx scripts/delete-chat-log.ts 2026-10-04 --apply        백업 저장 후 삭제
 *   npx tsx scripts/delete-chat-log.ts --all                     미리보기: 전체 기록
 *   npx tsx scripts/delete-chat-log.ts --all --apply             백업 저장 후 전체 삭제
 *
 * - 삭제 전 data/backup/chat-log-<범위>-<시각>.json 에 전체 행을 저장하고, 저장을 확인한 뒤에만 삭제한다.
 *   (백업에는 고객 질문 원문이 들어 있다. 개인정보가 있을 수 있으니 보관 후 안전하게 삭제할 것.)
 * - 미답변 질문(unanswered)은 지우지 않는다. 연결된 대화 기록이 삭제되면 unanswered.chat_log_id 만 비워진다(FK on delete set null).
 *   미답변도 비우려면 scripts/delete-unanswered-before.ts 를 쓴다.
 * - 대시보드·대화 로그 화면의 집계(답변 성공률 등)는 이 기록으로 계산되므로, 삭제하면 그 기간의 통계도 사라진다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

const PAGE = 1000;
const DELETE_BATCH = 100;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const all = args.includes("--all");
  const ymd = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!all && !ymd) throw new Error("사용법: tsx scripts/delete-chat-log.ts <YYYY-MM-DD | --all> [--apply]");
  if (all && ymd) throw new Error("날짜와 --all 은 함께 쓸 수 없습니다.");
  const cutoff = ymd ? new Date(`${ymd}T00:00:00+09:00`).toISOString() : null;

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from("chat_log").select("*").order("created_at").order("id");
    if (cutoff) q = q.lt("created_at", cutoff);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const { count: total } = await db.from("chat_log").select("*", { count: "exact", head: true });

  const byRoute: Record<string, number> = {};
  for (const r of rows) byRoute[String(r.route)] = (byRoute[String(r.route)] ?? 0) + 1;
  const ids = rows.map((r) => r.id as string);
  let linked = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const { count } = await db.from("unanswered").select("*", { count: "exact", head: true }).in("chat_log_id", ids.slice(i, i + DELETE_BATCH));
    linked += count ?? 0;
  }
  const range = all ? "전체" : `${ymd} 00:00 KST 이전`;
  console.log(`[chat_log] ${range}: ${rows.length}건 / 전체 ${total}건 (남는 건수 ${(total ?? 0) - rows.length})`);
  console.log("  경로별:", JSON.stringify(byRoute));
  console.log(`  이 기록에 연결된 미답변 질문 ${linked}건 (삭제되지 않고 연결만 해제됩니다)`);
  if (!apply) return console.log("[chat_log] 미리보기입니다. 삭제하려면 --apply");
  if (rows.length === 0) return console.log("[chat_log] 삭제할 기록이 없습니다.");

  await mkdir("data/backup", { recursive: true });
  const file = `data/backup/chat-log-${all ? "all" : `before-${ymd}`}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  await writeFile(file, JSON.stringify(rows, null, 1), "utf8");
  if (JSON.parse(await readFile(file, "utf8")).length !== rows.length) throw new Error("백업 검증 실패 — 삭제하지 않았습니다.");

  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const { data, error } = await db.from("chat_log").delete().in("id", ids.slice(i, i + DELETE_BATCH)).select("id");
    if (error) throw error;
    deleted += data?.length ?? 0;
  }
  const { count: left } = await db.from("chat_log").select("*", { count: "exact", head: true });
  console.log(`[chat_log] 삭제 ${deleted}건 완료 (남은 ${left}건). 백업: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
