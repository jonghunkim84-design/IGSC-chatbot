/**
 * 배포된 URL(또는 로컬 프로덕션 서버)의 동작을 확인한다.
 * 실행: npm run smoke:deploy -- https://your-app.vercel.app
 *
 * 확인 항목: 헬스체크(DB 연결), 챗봇 화면·위젯 파일, 관리자 보호, 개발용 경로 차단, 보안 헤더,
 *           챗봇 API의 고정 응답 경로(컨설팅 차단·이의제기·무관 질문·영어·FAQ 없음) 와 SSE 스트리밍.
 * 챗봇 API 호출은 실제 chat_log 에 기록된다 (테스트 질문 몇 건).
 */
const base = (process.argv[2] ?? process.env.CHAT_BASE_URL ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("사용법: npm run smoke:deploy -- https://배포주소");
  process.exit(2);
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

async function chat(message: string) {
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  const raw = await res.text();
  let route = "";
  let text = "";
  let deltas = 0;
  for (const block of raw.split("\n\n")) {
    const ev = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim());
    if (!ev) continue;
    const data = JSON.parse(ev[2]);
    if (ev[1] === "meta") route = data.route;
    if (ev[1] === "delta") {
      text += data.text;
      deltas++;
    }
  }
  return { status: res.status, type: res.headers.get("content-type") ?? "", route, text, deltas };
}

async function main() {
  console.log(`대상: ${base}\n`);

  const health = await fetch(`${base}/api/health`).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  check(`헬스체크: Supabase 연결`, health.status === 200 && health.body.ok === true, JSON.stringify(health.body));

  const root = await fetch(`${base}/`, { redirect: "manual" });
  check(`/ → /chat 이동`, root.status >= 300 && root.status < 400 && (root.headers.get("location") ?? "").endsWith("/chat"), `${root.status} ${root.headers.get("location")}`);

  const page = await fetch(`${base}/chat`);
  const html = await page.text();
  check(`/chat 화면`, page.status === 200 && html.includes("IGSC"), String(page.status));
  check(`/chat iframe 삽입 허용 헤더(frame-ancestors)`, (page.headers.get("content-security-policy") ?? "").includes("frame-ancestors"), page.headers.get("content-security-policy") ?? "(없음)");

  const widget = await fetch(`${base}/widget.js`);
  const js = await widget.text();
  check(`/widget.js 제공`, widget.status === 200 && js.includes("igsc-cw-root") && /javascript/.test(widget.headers.get("content-type") ?? ""), `${widget.status} ${widget.headers.get("content-type")}`);

  for (const p of ["/admin", "/admin/faq", "/admin/unanswered", "/admin/logs", "/admin/documents"]) {
    const r = await fetch(`${base}${p}`, { redirect: "manual" });
    check(`로그인 없이 ${p} → 로그인 화면`, r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/admin/login"), `${r.status}`);
  }
  const dlUnauth = await fetch(`${base}/admin/documents/123e4567-e89b-42d3-a456-426614174000/download`, { redirect: "manual" });
  check(`로그인 없이 문서 다운로드 경로 → 로그인 화면(파일 접근 불가)`, dlUnauth.status >= 300 && dlUnauth.status < 400 && (dlUnauth.headers.get("location") ?? "").includes("/admin/login"), String(dlUnauth.status));
  const adminApi = await fetch(`${base}/api/admin/anything`);
  check(`로그인 없이 /api/admin/* → 401`, adminApi.status === 401, String(adminApi.status));
  const login = await fetch(`${base}/admin/login`);
  check(`관리자 로그인 화면 + 프레임 삽입 차단 헤더`, login.status === 200 && (login.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), login.headers.get("content-security-policy") ?? "(없음)");

  const dbg = await fetch(`${base}/api/search?q=test`);
  check(`개발용 /api/search 는 운영에서 404`, dbg.status === 404, String(dbg.status));
  const wt = await fetch(`${base}/widget-test.html`);
  check(`개발용 /widget-test.html 은 운영에서 404`, wt.status === 404, String(wt.status));

  const c1 = await chat("우리 화장품이 비건 기준 통과하려면 뭘 고쳐야 하나요?");
  check(`챗봇 API: 컨설팅 차단 (SSE 스트림)`, c1.status === 200 && c1.type.includes("text/event-stream") && c1.route === "consulting_blocked" && c1.text.includes("공평성") && !/교체|하세요/.test(c1.text), c1.route);
  const c2 = await chat("심사 결과가 부당합니다");
  check(`챗봇 API: 이의제기 → 담당자 연결`, c2.route === "complaint" && c2.text.includes("02-858-4321"), c2.route);
  const c3 = await chat("날씨 어때?");
  check(`챗봇 API: 무관한 질문 → 인증 문의 전용 안내`, c3.route === "out_of_scope", c3.route);
  const c4 = await chat("How much does vegan certification cost?");
  check(`챗봇 API: 영어 질문 → 담당자 연결`, c4.route === "handoff" && c4.text.includes("Korean only"), c4.route);
  const c5 = await chat("탄소중립 인증은 얼마인가요?");
  check(`챗봇 API: FAQ에 없는 인증 → 추측 없이 담당자 이관`, c5.route === "handoff" && !/\d\s*(만원|원)/.test(c5.text), c5.route);
  const c6 = await chat("식품 비건 인증은 어떤 원칙으로 심사하나요?");
  console.log(`INFO  승인된 FAQ 질문 → route=${c6.route}, 스트림 조각 ${c6.deltas}개 (승인 데이터에 따라 answered 또는 handoff)`);

  const stranger = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "stranger@example.com" }) });
  check(`허용되지 않은 이메일 로그인 요청 → 발송 없이 동일 응답`, stranger.status === 200);

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("확인 중단:", e);
  process.exit(1);
});
