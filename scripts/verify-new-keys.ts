/**
 * Supabase 새 API 키(publishable / secret) 호환 검증. 운영 데이터는 바꾸지 않는다(시험 행은 만든 뒤 삭제).
 *
 * 준비: 프로젝트 폴더에 `.env.keytest` 파일을 만들고 새 키를 넣는다 (.env* 는 git 에 올라가지 않는다).
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
 * 실행: npx tsx scripts/verify-new-keys.ts [--no-app]
 *   A. 라이브러리 수준: secret 키(서버 전용 작업)와 publishable 키(익명 권한, 로그인 API) 점검
 *   B. 앱 수준: 새 키로 개발 서버(포트 3077)를 띄워 /api/health, /admin 보호, /api/chat(대화 기록 저장)을 점검 (--no-app 으로 생략)
 * 키 값은 출력하지 않는다.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

config({ path: ".env.local", quiet: true });
const base = { ...process.env };
if (!existsSync(".env.keytest")) {
  console.error("`.env.keytest` 파일이 없습니다. 파일 머리말의 안내대로 새 키를 넣어 만들어 주세요.");
  process.exit(2);
}
config({ path: ".env.keytest", override: true, quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SEC = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};
const msg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? ""));

async function partA() {
  console.log("── A. 라이브러리 수준 ──");
  // KEYTEST_ALLOW_LEGACY=1: 검증 스크립트 자체를 기존 키로 시험할 때만 쓰는 스위치(형식 검사를 건너뜀)
  const allowLegacy = process.env.KEYTEST_ALLOW_LEGACY === "1";
  if (!allowLegacy) {
    check("키 형식: publishable 키(sb_publishable_…)", PUB?.startsWith("sb_publishable_"), PUB ? `${PUB.slice(0, 15)}…` : "없음");
    check("키 형식: secret 키(sb_secret_…)", SEC?.startsWith("sb_secret_"), SEC ? `${SEC.slice(0, 10)}…` : "없음");
    check("키가 기존 키(.env.local)와 다르다", PUB !== base.NEXT_PUBLIC_SUPABASE_ANON_KEY && SEC !== base.SUPABASE_SERVICE_ROLE_KEY);
    if (!PUB?.startsWith("sb_publishable_") || !SEC?.startsWith("sb_secret_")) return;
  }

  // secret 키 = 서버 전용(RLS 우회) 작업
  const srv = createClient(URL, SEC, { auth: { persistSession: false, autoRefreshToken: false } });
  const faq = await srv.from("faq").select("id", { count: "exact", head: true });
  check("secret: faq 조회", !faq.error, faq.error ? msg(faq.error) : `${faq.count}건`);
  const cl = await srv.from("chat_log").select("id", { count: "exact", head: true });
  check("secret: chat_log 조회(RLS 우회)", !cl.error, cl.error ? msg(cl.error) : `${cl.count}건`);
  const st = await srv.storage.from("documents").list("", { limit: 1 });
  check("secret: 문서 저장소 목록", !st.error, st.error ? msg(st.error) : "");
  const key = `verify-keys:${Date.now()}`;
  const rl = await srv.rpc("rate_limit_hit", { p_key: key, p_window_seconds: 60, p_limit: 5 });
  check("secret: 요청 제한 함수(rate_limit_hit)", !rl.error && !!rl.data?.[0]?.allowed, rl.error ? msg(rl.error) : "");
  await srv.from("rate_limits").delete().eq("key", key);
  const au = await srv.auth.admin.listUsers({ page: 1, perPage: 1 });
  check("secret: 관리자 API(auth.admin)", !au.error, au.error ? msg(au.error) : "");

  // publishable 키 = 익명 권한
  const anon = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const af = await anon.from("faq").select("id, question").eq("status", "approved").limit(1);
  check("publishable: 승인 FAQ 읽기(허용된 컬럼)", !af.error, af.error ? msg(af.error) : `${af.data?.length ?? 0}건`);
  const ac = await anon.from("chat_log").select("id").limit(1);
  check("publishable: chat_log 는 읽을 수 없다", !!ac.error || (ac.data?.length ?? 0) === 0, ac.error ? "권한 오류(정상)" : "빈 결과(정상)");
  const ar = await anon.rpc("rate_limit_hit", { p_key: "x", p_window_seconds: 60, p_limit: 1 });
  check("publishable: 요청 제한 함수는 실행할 수 없다", !!ar.error, ar.error ? "권한 오류(정상)" : "실행됨(위험)");

  // 관리자 로그인 경로: @supabase/ssr 와 signInWithOtp (존재하지 않는 계정 + 가입 금지 → 메일은 가지 않는다)
  const ssr = createServerClient(URL, PUB, { cookies: { getAll: () => [], setAll: () => {} } });
  const gu = await ssr.auth.getUser();
  const ok1 = !gu.error || /session missing/i.test(msg(gu.error));
  check("publishable + @supabase/ssr: auth.getUser(세션 없음)", ok1, gu.error ? msg(gu.error) : "");
  const otp = await ssr.auth.signInWithOtp({ email: "keytest-nonexistent@example.invalid", options: { shouldCreateUser: false } });
  const otpMsg = msg(otp.error);
  check("publishable: 로그인 링크 API 가 키를 받아들인다(메일은 발송되지 않음)", !!otp.error && !/invalid api key|apikey|unauthor/i.test(otpMsg), otpMsg || "오류 없음(메일이 발송됐을 수 있음)");
}

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500 || r.status === 503) return true;
    } catch {
      /* 아직 기동 중 */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function partB() {
  console.log("── B. 앱 수준 (새 키로 개발 서버 기동, 포트 3077) ──");
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_ANON_KEY: PUB, SUPABASE_SERVICE_ROLE_KEY: SEC, NEXT_TELEMETRY_DISABLED: "1" };
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", "3077"], { env, shell: true, stdio: "ignore" });
  const kill = () => {
    try {
      if (child.pid) execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* 이미 종료 */
    }
  };
  try {
    const up = await waitFor("http://localhost:3077/api/health", 120000);
    check("개발 서버 기동", up);
    if (!up) return;
    const h = await fetch("http://localhost:3077/api/health").then((r) => r.json().catch(() => ({})));
    check("/api/health: DB 연결(secret 키)", h.db === true, JSON.stringify(h));
    const a = await fetch("http://localhost:3077/admin", { redirect: "manual" });
    check("/admin 로그인 없이 차단(publishable 키로 미들웨어 동작)", a.status >= 300 && a.status < 400 && (a.headers.get("location") ?? "").includes("/admin/login"), String(a.status));
    const sid = `verify-keys-${Date.now()}`;
    const c = await fetch("http://localhost:3077/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "오늘 날씨 어때?", sessionId: sid, source: "homepage" }) });
    const body = await c.text();
    check("/api/chat 응답(SSE)", c.status === 200 && body.includes("event: done"), `HTTP ${c.status}`);
    const srv = createClient(URL, SEC, { auth: { persistSession: false } });
    const row = await srv.from("chat_log").select("id, route, source").eq("session_id", sid);
    check("대화 기록 저장(secret 키)", (row.data?.length ?? 0) === 1 && row.data?.[0].source === "homepage", row.error ? msg(row.error) : JSON.stringify(row.data));
    await srv.from("chat_log").delete().eq("session_id", sid);
  } finally {
    kill();
  }
}

async function main() {
  await partA();
  if (!process.argv.includes("--no-app") && failed === 0) await partB();
  else if (failed > 0) console.log("(A 단계 실패가 있어 B 단계는 건너뜁니다)");
  console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과: 새 키로 이 시스템이 동작합니다.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
