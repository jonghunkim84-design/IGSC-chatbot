/**
 * FAQ의 출처 문서를 다른 문서(보통 개정판)로 옮긴다.
 *   npx tsx scripts/move-faq-source.ts <이전 문서 id> <새 문서 id>            미리보기
 *   npx tsx scripts/move-faq-source.ts <이전 문서 id> <새 문서 id> --apply    이동
 * 각 FAQ의 근거 문장(source_evidence)이 새 문서의 같은 쪽 텍스트에 그대로 있을 때만 옮긴다 (띄어쓰기 무시).
 * 근거를 새 문서에서 찾지 못하는 FAQ는 옮기지 않고 목록으로 알려준다. 이전 값은 data/backup 에 저장한다.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";

config({ path: ".env.local" });
const norm = (s: string) => s.replace(/[\s\-•·*()（）\[\]/,.:;"'“”‘’!?~▶]/g, "").toLowerCase();

async function main() {
  const [oldId, newId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--apply");
  if (!oldId || !newId) throw new Error("사용법: tsx scripts/move-faq-source.ts <이전 문서 id> <새 문서 id> [--apply]");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const { data: nd } = await db.from("documents").select("file_name,status").eq("id", newId).single();
  const { data: ch } = await db.from("doc_chunks").select("page_no,content").eq("document_id", newId);
  const byPage = new Map<number | null, string>();
  for (const c of ch ?? []) byPage.set(c.page_no, (byPage.get(c.page_no) ?? "") + norm(c.content));
  const all = [...byPage.values()].join("");

  const { data: faqs } = await db.from("faq").select("id,question,status,source_page,source_evidence,source_doc_id").eq("source_doc_id", oldId);
  const movable: typeof faqs = [], blocked: { q: string; why: string }[] = [];
  for (const f of faqs ?? []) {
    const ev: string[] = f.source_evidence ?? [];
    if (!ev.length) { blocked.push({ q: f.question, why: "근거 문장 없음" }); continue; }
    const page = byPage.get(f.source_page) ?? "";
    const missing = ev.find((l) => norm(l).length >= 4 && !page.includes(norm(l)));
    if (missing === undefined) movable!.push(f);
    else blocked.push({ q: f.question, why: all.includes(norm(missing)) ? `쪽이 다름(p.${f.source_page}에 없음)` : `새 문서에 없음: ${missing.slice(0, 30)}` });
  }
  console.log(`[move-source] ${nd?.file_name} (${nd?.status}) 로 이동: 대상 ${faqs?.length ?? 0}건 → 이동 ${movable!.length}건, 보류 ${blocked.length}건`);
  for (const b of blocked) console.log(`  보류: ${b.q} — ${b.why}`);
  if (!apply) return console.log("[move-source] 미리보기입니다. 이동하려면 --apply");
  if (!movable!.length) return;
  await mkdir("data/backup", { recursive: true });
  const file = `data/backup/faq-source-move-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  await writeFile(file, JSON.stringify(movable!.map((f) => ({ id: f.id, source_doc_id: f.source_doc_id, source_page: f.source_page })), null, 1), "utf8");
  const { data, error } = await db.from("faq").update({ source_doc_id: newId }).in("id", movable!.map((f) => f.id)).eq("source_doc_id", oldId).select("id");
  if (error) throw error;
  console.log(`[move-source] 이동 ${data!.length}건 완료. 이전 값 백업: ${file}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
