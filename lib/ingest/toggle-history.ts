/**
 * 적재한 인증 이력(data/cert-history-loaded.json)의 공개 여부를 일괄 변경.
 * 실행: npm run ingest:history:public -- off   (노출 끔: company_public=false)
 *       npm run ingest:history:public -- on    (노출 켬: company_public=true)
 * 이 스크립트로 적재한 행만 바꾼다 (관리자가 직접 넣은 행은 건드리지 않음).
 */
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";

config({ path: ".env.local" });

async function main() {
  const mode = process.argv[2];
  if (mode !== "on" && mode !== "off") throw new Error("사용법: npm run ingest:history:public -- on|off");
  const ids: string[] = JSON.parse(await readFile(path.join(process.cwd(), "data", "cert-history-loaded.json"), "utf8"));
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase
    .from("cert_history")
    .update({ company_public: mode === "on" })
    .in("id", ids)
    .select("id");
  if (error) throw error;
  const { count } = await supabase.from("cert_history").select("*", { count: "exact", head: true }).eq("company_public", true);
  console.log(`[history-public] ${mode}: ${data?.length ?? 0}행 변경 (현재 공개 행 ${count ?? 0}건)`);
}

main().catch((err) => {
  console.error("[history-public] 실패:", err);
  process.exit(1);
});
