/**
 * FAQ 승인 상태 되돌리기 / 복원. 기본은 미리보기(DB 쓰기 없음).
 *
 *   npx tsx scripts/reset-faq-approval.ts                      미리보기: 현재 승인 건수와 백업 파일 경로
 *   npx tsx scripts/reset-faq-approval.ts --apply              백업 저장 후 approved → draft 일괄 변경
 *   npx tsx scripts/reset-faq-approval.ts --restore <백업파일>   백업에 있는 id 를 다시 approved 로 복원
 *   (복원도 --apply 를 붙여야 실제로 쓴다)
 *
 * - 백업(data/backup/faq-approved-<시각>.json)에는 id·질문·인증 종류를 저장한다. 백업이 저장된 뒤에만 변경한다.
 * - 변경은 id 목록 기준이라, 실행 도중 새로 승인된 항목은 건드리지 않는다.
 * - 되돌린 뒤에는 승인 FAQ가 0건이라 챗봇은 모든 질문을 담당자 연결로 처리한다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";

config({ path: ".env.local" });
const BATCH = 100;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const restoreIdx = args.indexOf("--restore");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  if (restoreIdx >= 0) {
    const file = args[restoreIdx + 1];
    if (!file) throw new Error("--restore 다음에 백업 파일 경로가 필요합니다.");
    const backup: { id: string; approved_by?: string | null; approved_at?: string | null }[] = JSON.parse(await readFile(file, "utf8"));
    console.log(`[faq-approval] 복원 대상 ${backup.length}건 (${file})`);
    if (!apply) return console.log("[faq-approval] 미리보기입니다. 복원하려면 --apply");
    let n = 0;
    // 승인자·승인 시각도 백업에 있던 값으로 되돌린다 (항목마다 값이 달라 건별로 갱신)
    for (const b of backup) {
      const { data, error } = await db.from("faq").update({ status: "approved", approved_by: b.approved_by ?? null, approved_at: b.approved_at ?? null }).eq("id", b.id).select("id");
      if (error) throw error;
      n += data!.length;
    }
    return console.log(`[faq-approval] 복원 완료 ${n}건 → approved`);
  }

  const all: { id: string; question: string; cert_type: string; category: string; needs_input: boolean; approved_by: string | null; approved_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("faq").select("id,question,cert_type,category,needs_input,approved_by,approved_at").eq("status", "approved").range(from, from + 999);
    if (error) throw error;
    all.push(...data!);
    if (data!.length < 1000) break;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `data/backup/faq-approved-${stamp}.json`;
  console.log(`[faq-approval] 현재 승인 ${all.length}건. 백업 경로: ${backupPath}`);
  if (!apply) return console.log("[faq-approval] 미리보기입니다. 되돌리려면 --apply (백업 저장 후 approved → draft)");

  await mkdir("data/backup", { recursive: true });
  await writeFile(backupPath, JSON.stringify(all, null, 1), "utf8");
  const check = JSON.parse(await readFile(backupPath, "utf8"));
  if (check.length !== all.length) throw new Error("백업 검증 실패 — 변경하지 않았습니다.");
  let n = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const ids = all.slice(i, i + BATCH).map((f) => f.id);
    const { data, error } = await db.from("faq").update({ status: "draft", approved_by: null, approved_at: null }).in("id", ids).eq("status", "approved").select("id");
    if (error) throw error;
    n += data!.length;
  }
  const { count } = await db.from("faq").select("*", { count: "exact", head: true }).eq("status", "approved");
  console.log(`[faq-approval] 되돌림 완료 ${n}건 → draft (남은 승인 ${count}건). 복원: --restore ${backupPath} --apply`);
}
main().catch((e) => { console.error(e); process.exit(1); });
