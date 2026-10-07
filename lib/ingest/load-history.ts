/**
 * data/cert-history-raw.json → Supabase cert_history 적재 (업체별 묶음).
 * 실행: npm run ingest:history:load                       (미리보기만, DB 쓰기 없음)
 *       npm run ingest:history:load -- --apply            (실제 적재)
 *       npm run ingest:history:load -- --apply --replace  (이전 적재분 교체)
 * 입력 파일은 기본 data/cert-history-raw.json. 다른 파일은 옵션 앞에 경로를 준다 (예: data/cert-history-merged.json).
 *
 * - 한 행 = (업체, 인증 종류, 세부 유형) 한 묶음. 업체가 달라도 같은 묶음 키가 겹치면 별도 행.
 * - 업체명은 저장하지 않는다 (company_name = null). company_public = true 여야 챗봇이 이력을 쓰므로
 *   true 로 두되, 안내 문구는 업체명이 없으면 인증명·유형·연도만 노출한다 (lib/chat/history.ts).
 * - product_category 는 브랜드·제품명이 아닌 세부 유형 + 일반 제품 유형(data/cert-history-types.json,
 *   npm run ingest:history:types 로 생성)만 쓴다. 유형이 "미상"이면 세부 유형만 쓴다.
 * - --replace: 이전에 이 스크립트로 적재한 행(data/cert-history-loaded.json)만 지우고 다시 적재한다.
 * - cert_history 에 이미 행이 있으면 중단한다 (중복 적재 방지). 적재한 id 는
 *   data/cert-history-loaded.json 에 기록한다 (되돌리기용).
 */
import { config } from "dotenv";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawCert } from "./crawl-history";

config({ path: ".env.local" });

interface Mapped {
  cert_type: string;
  category: string | null;
}

/** 사이트의 인증제도 표기 → cert_type slug + 세부 유형. 매핑 없는 표기는 건너뛴다. */
function mapScheme(raw: string): Mapped | null {
  const s = raw.replace(/\s+/g, "").toLowerCase();
  if (!s) return null;
  if (s.includes("레스토랑") || s.includes("restaurant")) return { cert_type: "vegan", category: "레스토랑" };
  if (s.includes("베이커리") || s.includes("bakery")) return { cert_type: "vegan", category: "베이커리" };
  if (s.startsWith("비건메뉴") || s.includes("vegan menu") || s.includes("veganmenu")) return { cert_type: "vegan", category: "메뉴" };
  if (s.includes("비건") || s.includes("vegan")) return { cert_type: "vegan", category: "제품" };
  if (s.includes("업사이클") || s.includes("upcycle")) {
    const cat = s.includes("재료") || s.includes("소재") ? "재료·소재" : s.includes("제품") || s.includes("product") ? "제품" : null;
    return { cert_type: "upcycle", category: cat };
  }
  if (s.includes("반려동물")) return { cert_type: "pet-related-product", category: "제품" };
  if (s.includes("글루텐프리") || s.includes("gluten")) return { cert_type: "gluten-free", category: "제품" };
  if (s.includes("제로웨이스트")) {
    const cat = s.includes("조직") ? "조직" : s.includes("제품") ? "제품" : s.includes("이벤트") ? "이벤트" : null;
    return { cert_type: "zero-waste", category: cat };
  }
  if (s.includes("산호초")) return { cert_type: "coral-reef-friendly", category: "제품" };
  if (s.includes("mymicrobiome")) return { cert_type: "mymicrobiome", category: "제품" };
  if (s.includes("greentag")) return { cert_type: "global-greentag", category: "제품" };
  if (s.includes("유전자변형")) return { cert_type: "non-gmo", category: "제품" };
  if (s.includes("무설탕") || s.includes("설탕저감") || s.includes("suger-free") || s.includes("sugar-free")) return { cert_type: "sugar-free", category: "제품" };
  if (s.includes("gmo")) return { cert_type: "non-gmo", category: "제품" };
  if (s.includes("클린뷰티")) return { cert_type: "clean-beauty", category: "제품" };
  if (s.includes("additive")) return { cert_type: "clean-additive-free", category: "제품" };
  if (s.includes("방어구")) return { cert_type: "defense-equipment", category: null };
  if (s.startsWith("jas")) return { cert_type: "jas", category: "제품" };
  const iso = s.match(/^iso(\d+)(?:-(\d+))?/);
  if (iso) return { cert_type: `iso-${iso[1]}${iso[2] ? `-${iso[2]}` : ""}`, category: "조직" };
  return null;
}

const normCompany = (c: string) => c.replace(/\(주\)|㈜|\(유\)|\s/g, "");

async function main() {
  const apply = process.argv.includes("--apply");
  const replace = process.argv.includes("--replace");
  // --private: company_public=false 로 적재 (공개 동의 확인 전에는 챗봇이 이력을 쓰지 않는다)
  const priv = process.argv.includes("--private");
  const input = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join("data", "cert-history-raw.json");
  const raw: RawCert[] = JSON.parse(await readFile(path.resolve(input), "utf8"));
  const types: Record<string, string> = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "cert-history-types.json"), "utf8").catch(() => "{}"),
  );

  const groups = new Map<string, { cert_type: string; category: string | null; year: number }>();
  const skipped = new Map<string, number>();
  for (const r of raw) {
    const m = mapScheme(r.scheme);
    if (!m) {
      skipped.set(r.scheme || "(빈 값)", (skipped.get(r.scheme || "(빈 값)") ?? 0) + 1);
      continue;
    }
    const year = Number(r.issued.slice(0, 4)) || 0;
    const t = types[r.cert_no]?.trim();
    const category = !t || t === "미상" ? m.category : m.category && !t.includes(m.category) ? `${m.category} · ${t}` : t;
    const key = [normCompany(r.company), m.cert_type, category ?? ""].join("|");
    const g = groups.get(key);
    if (!g) groups.set(key, { cert_type: m.cert_type, category, year });
    else g.year = Math.max(g.year, year);
  }

  const { CERT_NAMES } = await import("../cert-names");
  // 등록된 인증 종류: DB(cert_types)가 원본. 읽지 못하면(테이블 없음 등) 코드의 기본값으로 확인한다.
  const known = new Set(Object.keys(CERT_NAMES));
  if (apply || process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const { createClient: mk } = await import("@supabase/supabase-js");
    const c = mk(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.from("cert_types").select("code");
    if (!error && data && data.length) {
      known.clear();
      for (const r of data) known.add(r.code as string);
    }
  }
  const rows = [...groups.values()].map((g) => ({
    cert_type: g.cert_type,
    product_category: g.category,
    company_public: !priv,
    company_name: null as string | null,
    year: g.year || null,
  }));
  const unknown = [...new Set(rows.map((r) => r.cert_type))].filter((t) => !known.has(t));
  if (unknown.length) throw new Error(`등록되지 않은 cert_type: ${unknown.join(", ")} — 관리자 화면 '인증 종류'에서 먼저 추가하세요.`);

  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.cert_type, (byType.get(r.cert_type) ?? 0) + 1);
  console.log(`[load-history] 원본 ${raw.length}건 → 업체별 묶음 ${rows.length}행`);
  console.log("  인증 종류별:", Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])));
  console.log("  제외(매핑 없음):", Object.fromEntries(skipped));
  if (!apply) {
    console.log("[load-history] 미리보기입니다. DB에 쓰려면 --apply 를 붙이세요.");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { count, error: cErr } = await supabase.from("cert_history").select("*", { count: "exact", head: true });
  if (cErr) throw cErr;
  const loadedFile = path.join(process.cwd(), "data", "cert-history-loaded.json");
  if ((count ?? 0) > 0) {
    if (!replace) throw new Error(`cert_history 에 이미 ${count}행이 있어 중단합니다 (중복 적재 방지). 교체하려면 --replace`);
    const prev: string[] = JSON.parse(await readFile(loadedFile, "utf8"));
    if (prev.length !== count) throw new Error(`이전 적재 id ${prev.length}건과 현재 행 ${count}건이 달라 중단합니다 (다른 행 보호).`);
    const { error: dErr } = await supabase.from("cert_history").delete().in("id", prev);
    if (dErr) throw dErr;
    await rename(loadedFile, loadedFile.replace(".json", ".prev.json"));
    console.log(`[load-history] 이전 적재분 ${prev.length}행 삭제 (id 백업: cert-history-loaded.prev.json)`);
  }

  const { data, error } = await supabase.from("cert_history").insert(rows).select("id");
  if (error) throw error;
  const ids = (data ?? []).map((d) => d.id as string);
  await writeFile(loadedFile, JSON.stringify(ids, null, 2), "utf8");
  console.log(`[load-history] 적재 완료: ${ids.length}행 (id 목록 → data/cert-history-loaded.json)`);
}

main().catch((err) => {
  console.error("[load-history] 실패:", err);
  process.exit(1);
});
