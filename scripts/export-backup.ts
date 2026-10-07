/**
 * 전체 데이터 백업 (읽기만 한다, DB·저장소는 바꾸지 않는다).
 *   npx tsx scripts/export-backup.ts              data/backup/full-<시각>/ 에 저장
 *   npx tsx scripts/export-backup.ts --no-files   문서 파일(저장소)은 건너뛴다
 *
 * - 테이블마다 <테이블>.json (전체 행), 문서 파일은 files/ 아래, 요약은 manifest.json 에 남긴다.
 * - 프로젝트 이전·키 재발급·대량 삭제 같은 되돌리기 어려운 작업 전에 실행한다.
 * - 백업에는 고객 질문 원문(대화 기록·미답변)과 고객 문서가 들어 있다. 개인정보가 있을 수 있으니 안전한 곳에 보관한다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });

const TABLES = ["faq", "cert_types", "cert_history", "documents", "doc_chunks", "generation_jobs", "chat_log", "unanswered"];
const ORDER_BY: Record<string, string> = { cert_types: "code" }; // 기본 정렬 키는 id
const BUCKET = "documents";
const PAGE = 1000;

async function main() {
  const withFiles = !process.argv.includes("--no-files");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없습니다.");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join("data", "backup", `full-${stamp}`);
  await mkdir(dir, { recursive: true });

  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select("*").order(ORDER_BY[table] ?? "id").range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} 읽기 실패: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE) break;
    }
    await writeFile(path.join(dir, `${table}.json`), JSON.stringify(rows, null, 1), "utf8");
    counts[table] = rows.length;
    console.log(`[backup] ${table}: ${rows.length}행`);
  }

  let fileCount = 0;
  let fileBytes = 0;
  const failed: string[] = [];
  if (withFiles) {
    await mkdir(path.join(dir, "files"), { recursive: true });
    const names: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await db.storage.from(BUCKET).list("", { limit: PAGE, offset });
      if (error) throw new Error(`저장소 목록 읽기 실패: ${error.message}`);
      for (const f of data ?? []) if (f.name && f.id) names.push(f.name);
      if ((data?.length ?? 0) < PAGE) break;
    }
    for (const name of names) {
      const { data, error } = await db.storage.from(BUCKET).download(name);
      if (error || !data) {
        failed.push(name);
        console.error(`[backup] 파일 실패: ${name} (${error?.message})`);
        continue;
      }
      const buf = Buffer.from(await data.arrayBuffer());
      await writeFile(path.join(dir, "files", name), buf);
      fileCount++;
      fileBytes += buf.length;
    }
    console.log(`[backup] 문서 파일: ${fileCount}개 (${(fileBytes / 1024 / 1024).toFixed(1)}MB)${failed.length ? `, 실패 ${failed.length}개` : ""}`);
  }

  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), supabaseUrl: url, counts, files: { count: fileCount, bytes: fileBytes, failed } }, null, 1), "utf8");
  console.log(`[backup] 완료: ${dir}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[backup] 실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
