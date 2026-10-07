/**
 * 문서 보관함에 이미 올라가 있는 문서(content_hash 가 없는 것)의 내용 해시를 계산해 채운다.
 * 마이그레이션 0010 적용 후 한 번 실행한다. 실행 전·후에 같은 내용의 문서가 있는지도 알려준다.
 *   npx tsx scripts/backfill-content-hash.ts            미리보기 (DB 쓰기 없음)
 *   npx tsx scripts/backfill-content-hash.ts --apply    해시 저장
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: docs, error } = await db.from("documents").select("id, file_name, version, status, storage_path, content_hash").order("created_at");
  if (error) throw error;
  const todo = (docs ?? []).filter((d) => !d.content_hash);
  console.log(`[hash] 문서 ${docs?.length ?? 0}건 중 해시가 없는 문서 ${todo.length}건`);

  const byHash = new Map<string, string[]>();
  for (const d of docs ?? []) if (d.content_hash) byHash.set(d.content_hash, [...(byHash.get(d.content_hash) ?? []), d.file_name]);
  let done = 0;
  for (const d of todo) {
    const { data: blob, error: dl } = await db.storage.from("documents").download(d.storage_path);
    if (dl || !blob) {
      console.log(`  - 건너뜀(파일을 읽지 못함): ${d.file_name}`);
      continue;
    }
    const hash = createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), `${d.file_name}${d.status === "archived" ? " (이전 버전)" : ""}`]);
    if (apply) {
      const { error: up } = await db.from("documents").update({ content_hash: hash }).eq("id", d.id);
      if (up) throw up;
    }
    done++;
  }
  console.log(`[hash] ${apply ? "저장" : "계산"} ${done}건`);
  const dups = [...byHash.values()].filter((names) => names.length > 1);
  console.log(dups.length ? `[hash] 내용이 같은 문서가 있습니다 (${dups.length}묶음):` : "[hash] 내용이 같은 문서 없음");
  for (const names of dups) console.log("  - " + names.join(" = "));
  if (!apply) console.log("[hash] 미리보기입니다. 저장하려면 --apply");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
