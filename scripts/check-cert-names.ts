/**
 * cert_type slug 중 인증 종류(DB cert_types, 없으면 lib/cert-names.ts 기본값)에 등록되지 않은 것을 찾아 목록으로 보여준다.
 * 실행: npm run cert-names:check
 * 대상: data/faq-draft.json, DB faq.cert_type, DB cert_history.cert_type
 * 크롤링 원문 제목(data/raw)에서 이름 후보를 찾으면 붙여 넣을 한 줄을 제안한다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { CERT_NAMES } from "@/lib/cert-names";
import { nameFromTitle } from "@/lib/ingest/cert-labels";

async function main() {
  const sources = new Map<string, Set<string>>(); // slug → 어디서 발견됐는지
  const add = (slug: string | null | undefined, where: string) => {
    if (!slug) return;
    if (!sources.has(slug)) sources.set(slug, new Set());
    sources.get(slug)!.add(where);
  };

  if (existsSync("data/faq-draft.json")) {
    for (const f of JSON.parse(readFileSync("data/faq-draft.json", "utf8"))) add(f.cert_type, "faq-draft.json");
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // 등록된 인증 종류: DB(cert_types)가 원본. 테이블이 아직 없으면 코드의 기본값을 쓴다.
  const known = new Set(Object.keys(CERT_NAMES));
  {
    const { data, error } = await sb.from("cert_types").select("code");
    if (!error && data && data.length) {
      known.clear();
      for (const r of data) known.add(r.code as string);
    } else console.log("(cert_types 테이블을 읽지 못해 lib/cert-names.ts 기본값으로 비교합니다)");
  }
  const hasCertName = (slug: string) => known.has(slug);
  for (const [table, label] of [["faq", "DB faq"], ["cert_history", "DB cert_history"]] as const) {
    const { data, error } = await sb.from(table).select("cert_type");
    if (error) throw error;
    for (const r of data ?? []) add(r.cert_type as string, label);
  }

  // 원문 제목에서 이름 후보 (draft의 출처 URL 기준)
  const titleByUrl = new Map<string, string>();
  if (existsSync("data/raw")) {
    for (const f of readdirSync("data/raw")) {
      const r = JSON.parse(readFileSync(`data/raw/${f}`, "utf8"));
      titleByUrl.set(r.url, r.title);
    }
  }
  const candidates = new Map<string, Set<string>>();
  if (existsSync("data/faq-draft.json")) {
    for (const f of JSON.parse(readFileSync("data/faq-draft.json", "utf8"))) {
      const name = nameFromTitle(titleByUrl.get(f.source_url) ?? "");
      if (name && !hasCertName(f.cert_type)) {
        if (!candidates.has(f.cert_type)) candidates.set(f.cert_type, new Set());
        candidates.get(f.cert_type)!.add(name);
      }
    }
  }

  const unmapped = [...sources.keys()].filter((s) => !hasCertName(s)).sort();
  console.log(`등록된 slug ${known.size}개 / 사용 중인 slug ${sources.size}개`);
  if (unmapped.length === 0) {
    console.log("등록되지 않은 slug: 없음");
    return;
  }
  console.log(`
등록되지 않은 slug (${unmapped.length}) — 관리자 화면 '인증 종류'에서 추가하세요:`);
  for (const s of unmapped) {
    const hint = /[가-힣]/.test(s) ? "  ← slug가 아니라 한글 이름이 그대로 들어간 값일 수 있음" : "";
    console.log(`  - ${s}  [${[...sources.get(s)!].join(", ")}]${hint}`);
    const c = candidates.get(s);
    if (c) console.log(`      제안: ${JSON.stringify(s)}: ${JSON.stringify([...c][0])},`);
  }
  process.exitCode = 1;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
