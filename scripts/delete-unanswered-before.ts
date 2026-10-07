/**
 * 미답변 질문(unanswered) 중 지정한 날짜(KST 0시) 이전에 생성된 행 삭제.
 *   npx tsx scripts/delete-unanswered-before.ts 2026-10-02            미리보기
 *   npx tsx scripts/delete-unanswered-before.ts 2026-10-02 --apply    백업 저장 후 삭제
 * - 삭제 전 data/backup/unanswered-before-<날짜>-<시각>.json 에 전체 행을 저장한다 (저장 검증 후에만 삭제).
 * - chat_log 는 건드리지 않는다 (unanswered.chat_log_id 는 chat_log 를 가리킬 뿐이다).
 * - 이 행에서 만든 FAQ 초안의 source_unanswered_id 는 FK(on delete set null)로 비워진다. FAQ 자체는 그대로다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });

async function main() {
  const ymd = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? "")) throw new Error("사용법: tsx scripts/delete-unanswered-before.ts YYYY-MM-DD [--apply]");
  const apply = process.argv.includes("--apply");
  const cutoff = new Date(`${ymd}T00:00:00+09:00`).toISOString();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data, error } = await db.from("unanswered").select("*").lt("created_at", cutoff).order("created_at");
  if (error) throw error;
  const rows = data ?? [];
  const { count: total } = await db.from("unanswered").select("*", { count: "exact", head: true });
  console.log(`[unanswered] 기준 ${ymd} 00:00 KST (${cutoff}) 이전 ${rows.length}건 / 전체 ${total}건 (남는 건수 ${(total ?? 0) - rows.length})`);
  if (!apply) return console.log("[unanswered] 미리보기입니다. 삭제하려면 --apply");
  if (rows.length === 0) return console.log("[unanswered] 삭제할 행이 없습니다.");

  await mkdir("data/backup", { recursive: true });
  const file = `data/backup/unanswered-before-${ymd}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  await writeFile(file, JSON.stringify(rows, null, 1), "utf8");
  if (JSON.parse(await readFile(file, "utf8")).length !== rows.length) throw new Error("백업 검증 실패 — 삭제하지 않았습니다.");

  let deleted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map((r) => r.id as string);
    const { data: d, error: e } = await db.from("unanswered").delete().in("id", ids).lt("created_at", cutoff).select("id");
    if (e) throw e;
    deleted += d!.length;
  }
  const { count: left } = await db.from("unanswered").select("*", { count: "exact", head: true });
  console.log(`[unanswered] 삭제 ${deleted}건 완료 (남은 ${left}건). 백업: ${file}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
