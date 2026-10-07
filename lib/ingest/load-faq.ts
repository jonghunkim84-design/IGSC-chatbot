/**
 * data/faq-draft.json → Supabase faq 테이블 적재.
 * 실행: npm run ingest:load
 *
 * - 이미 있는 id는 업데이트, 없으면 삽입 (upsert, onConflict: id)
 * - 이미 'approved'로 승인된 행은 덮어쓰지 않고 건너뛴다 (검수 결과 보호)
 * - needs_input 함께 적재. 임베딩 생성 단계 없음 (프롬프트 선택 방식)
 * - evidence / source_urls / merge_key 는 검수용이라 적재하지 않는다
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Faq } from "../db/types";

config({ path: ".env.local" });

type DraftRow = Pick<
  Faq,
  "id" | "question" | "variants" | "answer" | "cert_type" | "category" | "source_url" | "lang" | "status" | "needs_input"
> &
  Record<string, unknown>;

const BATCH = 100;

async function main() {
  // server.ts 는 "server-only" 가드가 있어 스크립트에서 import 할 수 없으므로 여기서 직접 생성
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const draft: DraftRow[] = JSON.parse(await readFile(path.join(process.cwd(), "data", "faq-draft.json"), "utf8"));
  if (draft.length === 0) throw new Error("faq-draft.json 이 비어 있습니다.");

  // 승인된 행 보호
  const { data: approved, error: selErr } = await supabase.from("faq").select("id").eq("status", "approved");
  if (selErr) throw selErr;
  const approvedIds = new Set((approved ?? []).map((r) => r.id as string));

  const rows = draft
    .filter((r) => !approvedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      question: r.question,
      variants: r.variants,
      answer: r.answer,
      cert_type: r.cert_type,
      category: r.category,
      source_url: r.source_url,
      lang: r.lang,
      status: "draft" as const,
      needs_input: r.needs_input,
    }));
  const skipped = draft.length - rows.length;

  const { data: existing, error: exErr } = await supabase.from("faq").select("id");
  if (exErr) throw exErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const updates = rows.filter((r) => existingIds.has(r.id)).length;

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from("faq").upsert(rows.slice(i, i + BATCH), { onConflict: "id" });
    if (error) throw error;
  }
  console.log(
    `[load] 완료: 삽입 ${rows.length - updates}, 업데이트 ${updates}, 승인본이라 건너뜀 ${skipped} (초안 파일 ${draft.length}건)`,
  );
}

main().catch((err) => {
  console.error("[load] 실패:", err);
  process.exit(1);
});
