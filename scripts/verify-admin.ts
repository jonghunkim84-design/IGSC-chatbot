/**
 * Phase 6 검증 (실제 DB, 개발 서버 필요).
 * 실행: (dev 서버 실행 중) npm run verify:admin
 *
 * - 접근 제어: 허용 목록/미들웨어 판정, 로그인 없는 접근 차단, 비허용 이메일의 로그인 요청
 * - FAQ: 필터·검색·페이지네이션, 저장 검증, 일괄 승인 규칙, 수정 즉시 반영(재배포·무효화 호출 없이 다른 프로세스에서 수정)
 * - 미답변: 등록/처리 완료 흐름
 * - 대시보드: 숫자를 chat_log 원본과 독립적인 방식(head count)으로 다시 세어 비교
 * 임시로 만든 행은 모두 삭제하고, 수정한 dev 승인 FAQ는 원래 값으로 복구한다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { decideAccess } from "@/lib/admin/access";
import { isAllowedEmail, parseAllowedEmails } from "@/lib/admin/allowlist";
import { PAGE_SIZE, addDaysYmd, kstDayStartISO, kstTodayYmd, kstWeekStartYmd } from "@/lib/admin/labels";
import { bulkApprove, insertFaqAdmin, listFaqs, validateFaqInput, type FaqInput } from "@/lib/db/admin-faq";
import { listChatLogs } from "@/lib/db/admin-logs";
import { getDashboardStats } from "@/lib/db/admin-stats";
import { getUnansweredAdmin, listUnansweredAdmin, setUnansweredResolved } from "@/lib/db/admin-unanswered";
import { insertUnanswered } from "@/lib/db/unanswered";

const BASE = process.env.CHAT_BASE_URL ?? "http://localhost:3000";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

const base: FaqInput = {
  question: "[TEST-ADMIN] 임시 질문",
  variants: ["임시 표현"],
  answer: "임시 답변",
  cert_type: "common",
  category: "scope",
  source_url: null,
  status: "draft",
  needs_input: false,
};

async function headCount(build: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count, error } = await build(sb.from("chat_log").select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
}

async function chat(message: string): Promise<{ route: string; text: string }> {
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  const raw = await res.text();
  let route = "";
  let text = "";
  for (const block of raw.split("\n\n")) {
    const ev = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim());
    if (!ev) continue;
    const data = JSON.parse(ev[2]);
    if (ev[1] === "meta") route = data.route;
    if (ev[1] === "delta") text += data.text;
  }
  return { route, text };
}

async function main() {
  // ── 1. 접근 제어
  {
    const raw = " Admin@Example.com , second@example.com ,, ";
    check(`허용 목록 파싱(공백·대소문자·빈 항목)`, parseAllowedEmails(raw).join("|") === "admin@example.com|second@example.com");
    check(`허용 이메일 판정`, isAllowedEmail("ADMIN@example.com", raw) && !isAllowedEmail("other@example.com", raw) && !isAllowedEmail(null, raw) && !isAllowedEmail("", raw));
    check(`목록이 비어 있으면 아무도 허용하지 않음`, !isAllowedEmail("admin@example.com", "") && !isAllowedEmail("admin@example.com", undefined));
    const ok = "admin@example.com";
    check(`미들웨어: 로그인 안 함 → login`, decideAccess("/admin", null, raw) === "login" && decideAccess("/admin/faq/123", undefined, raw) === "login" && decideAccess("/api/admin/x", null, raw) === "login");
    check(`미들웨어: 허용되지 않은 이메일 → forbidden`, decideAccess("/admin", "other@example.com", raw) === "forbidden" && decideAccess("/admin/logs", "other@example.com", raw) === "forbidden");
    check(`미들웨어: 허용된 이메일 → allow`, decideAccess("/admin", ok, raw) === "allow" && decideAccess("/admin/faq", ok, raw) === "allow");
    check(`미들웨어: 로그인/콜백/로그인 API는 공개`, decideAccess("/admin/login", null, raw) === "allow" && decideAccess("/admin/auth/callback", null, raw) === "allow" && decideAccess("/api/admin/login", null, raw) === "allow");
    check(`미들웨어: 비슷한 경로로 우회 불가(/admin/loginx, /admin/authx)`, decideAccess("/admin/loginx", null, raw) === "login" && decideAccess("/admin/authx/callback", null, raw) === "login");

    for (const p of ["/admin", "/admin/faq", "/admin/faq/new", "/admin/unanswered", "/admin/logs"]) {
      const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
      const loc = r.headers.get("location") ?? "";
      check(`HTTP 로그인 없이 ${p} → 로그인 화면으로 이동`, r.status >= 300 && r.status < 400 && loc.includes("/admin/login"), `${r.status} ${loc}`);
    }
    const api = await fetch(`${BASE}/api/admin/anything`);
    check(`HTTP 로그인 없이 /api/admin/* → 401`, api.status === 401, String(api.status));
    const bad = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "not-an-email" }) });
    check(`잘못된 이메일 형식 → 400`, bad.status === 400);
    const denied = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "stranger@example.com" }) });
    const deniedBody = await denied.json();
    check(`허용되지 않은 이메일 로그인 요청 → 메일 발송 없이 동일한 성공 응답(주소 추측 방지)`, denied.status === 200 && deniedBody.ok === true);
    const { data: users } = await sb.auth.admin.listUsers({ page: 1, perPage: 50 });
    check(`허용되지 않은 이메일로 Auth 사용자가 생성되지 않음`, !users.users.some((u) => u.email === "stranger@example.com"));
  }

  // ── 2. FAQ 검증·목록·일괄 승인
  const created: string[] = [];
  try {
    check(`검증: 빈 질문 거부`, validateFaqInput({ ...base, question: " " }) !== null);
    check(`검증: 잘못된 출처 URL 거부`, validateFaqInput({ ...base, source_url: "javascript:alert(1)" }) !== null);
    check(`검증: 승인 + 보완 필요 표시 → 거부`, validateFaqInput({ ...base, status: "approved", needs_input: true }) !== null);
    check(`검증: 승인 + 빈 답변 → 거부`, validateFaqInput({ ...base, status: "approved", answer: " " }) !== null);
    check(`검증: 정상 입력 통과`, validateFaqInput({ ...base, status: "approved", source_url: "https://igsc.kr/x" }) === null);

    const ok = await insertFaqAdmin({ ...base, question: "[TEST-ADMIN] 승인 가능" });
    const pending = await insertFaqAdmin({ ...base, question: "[TEST-ADMIN] 보완 필요", answer: "", needs_input: true });
    const empty = await insertFaqAdmin({ ...base, question: "[TEST-ADMIN] 빈 답변", answer: "" });
    created.push(ok.id, pending.id, empty.id);

    const found = await listFaqs({ q: "[TEST-ADMIN]" });
    check(`키워드 검색`, found.total === 3, `${found.total}건`);
    const onlyPending = await listFaqs({ q: "[TEST-ADMIN]", status: "draft", category: "scope", certType: "common" });
    check(`필터 조합(상태+카테고리+인증)`, onlyPending.total === 3);
    const noHit = await listFaqs({ q: "[TEST-ADMIN]", certType: "vegan" });
    check(`인증 종류 필터`, noHit.total === 0);
    check(`검색어의 특수문자(쉼표·괄호·%)로 쿼리가 깨지지 않음`, (await listFaqs({ q: "a,b(c)%_*" })).total >= 0);

    const result = await bulkApprove([ok.id, pending.id, empty.id], "verify-script");
    check(`일괄 승인: 정상 1건만 승인, 보완 필요·빈 답변은 건너뜀`, result.approved === 1 && result.skipped === 2, JSON.stringify(result));
    const { data: after } = await sb.from("faq").select("id, status").in("id", created);
    const st = Object.fromEntries((after ?? []).map((r) => [r.id, r.status]));
    check(`일괄 승인 후 DB 상태`, st[ok.id] === "approved" && st[pending.id] === "draft" && st[empty.id] === "draft");

    // 페이지네이션: 전체 목록을 페이지 단위로 훑어 합이 total 과 같고 중복이 없는지
    const first = await listFaqs({ page: 1 });
    const seen = new Set<string>();
    for (let p = 1; p <= Math.ceil(first.total / PAGE_SIZE); p++) for (const r of (await listFaqs({ page: p })).rows) seen.add(r.id);
    check(`페이지네이션: 모든 페이지의 합 = 전체 건수, 중복 없음`, seen.size === first.total && first.rows.length <= PAGE_SIZE, `${seen.size}/${first.total}건, 페이지당 ${PAGE_SIZE}`);
  } finally {
    if (created.length) await sb.from("faq").delete().in("id", created);
  }

  // ── 3. 수정 즉시 반영: 다른 프로세스(이 스크립트)에서 DB만 수정 → 챗봇 서버는 무효화 호출을 받지 못했음에도 반영
  {
    const { data: rows } = await sb.from("faq").select("id, answer").eq("status", "approved").ilike("question", "%유기농(Organic) 인증이란%");
    const target = rows?.[0];
    if (!target) throw new Error("dev 승인 FAQ(유기농) 를 찾지 못함");
    const original = target.answer as string;
    try {
      const before = await chat("유기농 인증이란 무엇인가요?");
      check(`수정 전 답변에 원래 값(3년) 포함`, before.route === "answered" && before.text.includes("3년"), before.route);

      await sb.from("faq").update({ answer: original.replace("3년", "7년") }).eq("id", target.id); // 캐시 무효화 호출 없음
      const after = await chat("유기농 인증이란 무엇인가요?");
      check(`FAQ 수정이 재배포·캐시 무효화 호출 없이 챗봇 답변에 즉시 반영`, after.text.includes("7년") && !after.text.includes("3년"), after.text.split("\n")[0].slice(0, 60));
    } finally {
      await sb.from("faq").update({ answer: original }).eq("id", target.id);
    }
    const restored = await chat("유기농 인증이란 무엇인가요?");
    check(`복구 후 원래 값으로 답변`, restored.text.includes("3년"));
  }

  // ── 4. 미답변 → 등록 → 처리 완료
  {
    const u = await insertUnanswered("[TEST-ADMIN] 미답변 테스트 질문");
    try {
      const open = await listUnansweredAdmin({ resolved: false });
      check(`미처리 목록에 표시(최신순)`, open.rows.some((r) => r.id === u.id) && open.rows[0].created_at >= open.rows[open.rows.length - 1].created_at);
      await setUnansweredResolved(u.id, true);
      const got = await getUnansweredAdmin(u.id);
      check(`처리 완료 표시`, got?.resolved === true);
      check(`처리 완료 후 미처리 목록에서 제외`, !(await listUnansweredAdmin({ resolved: false })).rows.some((r) => r.id === u.id));
      await setUnansweredResolved(u.id, false);
      check(`되돌리기`, (await getUnansweredAdmin(u.id))?.resolved === false);
    } finally {
      await sb.from("unanswered").delete().eq("id", u.id);
    }
  }

  // ── 5. 대화 로그 필터
  {
    const today = kstTodayYmd();
    const all = await listChatLogs({});
    const rawAll = await headCount((q) => q);
    check(`로그 전체 건수 = chat_log 원본`, all.total === rawAll, `${all.total}/${rawAll}`);
    const handoff = await listChatLogs({ route: "handoff" });
    check(`route 필터 건수`, handoff.total === (await headCount((q) => q.eq("route", "handoff"))) && handoff.rows.every((r) => r.route === "handoff"));
    const todayLogs = await listChatLogs({ from: today, to: today });
    const rawToday = await headCount((q) => q.gte("created_at", kstDayStartISO(today)).lt("created_at", kstDayStartISO(addDaysYmd(today, 1))));
    check(`날짜 필터(KST 하루)`, todayLogs.total === rawToday, `${todayLogs.total}/${rawToday}`);
    const withFaq = all.rows.find((r) => (r.matched_faq_ids?.length ?? 0) > 0);
    check(`근거 FAQ 확인 가능(matched_faq_ids → 질문 조회)`, !withFaq || withFaq.matched_faq_ids.every((id) => all.faqQuestions.has(id)));
  }

  // ── 6. 대시보드 수치 = chat_log 원본 (독립적인 head count 로 재계산)
  {
    const now = new Date();
    const stats = await getDashboardStats(now);
    const todayStart = kstDayStartISO(kstTodayYmd(now));
    const weekStart = kstDayStartISO(kstWeekStartYmd(now));
    const routes = ["answered", "handoff", "clarify", "consulting_blocked", "complaint", "out_of_scope"];
    for (const [label, start, s] of [["오늘", todayStart, stats.today], ["이번 주", weekStart, stats.week]] as const) {
      const raw: Record<string, number> = {};
      for (const r of routes) raw[r] = await headCount((q) => q.eq("route", r).gte("created_at", start));
      const rawTotal = await headCount((q) => q.gte("created_at", start));
      check(`대시보드 ${label} 문의 수 = 원본`, s.total === rawTotal, `${s.total}/${rawTotal}`);
      check(`대시보드 ${label} route별 건수 = 원본`, routes.every((r) => (s.byRoute[r] ?? 0) === raw[r]), routes.map((r) => `${r}:${s.byRoute[r] ?? 0}/${raw[r]}`).join(" "));
      const expectedRate = raw.answered + raw.handoff > 0 ? raw.answered / (raw.answered + raw.handoff) : null;
      check(`대시보드 ${label} 답변 성공률 = 원본 계산`, s.successRate === expectedRate, `${s.successRate === null ? "-" : (s.successRate * 100).toFixed(1) + "%"}`);
    }
    check(`이번 주 ≥ 오늘`, stats.week.total >= stats.today.total);
    const top = stats.topQuestions;
    check(`Top 10 개수·정렬`, top.length <= 10 && top.every((t, i) => i === 0 || top[i - 1].count >= t.count));
    let topOk = true;
    for (const t of top) {
      const raw = await headCount((q) => q.eq("question", t.question).gte("created_at", stats.ranges.topFrom));
      if (raw !== t.count) topOk = false;
    }
    check(`Top 10 각 질문의 횟수 = 원본 재계산`, topOk, top.slice(0, 3).map((t) => `${t.question.slice(0, 14)}…×${t.count}`).join(", "));
    const { count } = await sb.from("unanswered").select("id", { count: "exact", head: true }).eq("resolved", false);
    check(`미처리 미답변 건수 = 원본`, stats.openUnanswered === (count ?? 0), String(stats.openUnanswered));
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("검증 중단:", e);
  process.exit(1);
});
