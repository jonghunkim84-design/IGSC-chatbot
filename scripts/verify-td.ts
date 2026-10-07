/**
 * Phase 11 검증 TD-01 ~ TD-10 (실제 Claude API + Supabase). 시나리오: docs/test-scenarios-docs.md
 * 실행: npm run verify:td   (필요: supabase/migrations/0006 적용)
 * 만든 문서·파일·미답변·FAQ 는 모두 삭제하고 승인 FAQ 수가 그대로인지 확인한다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { hasCertName } from "@/lib/cert-names";
import { checkFile, storagePathFor } from "@/lib/admin/documents";
import { DOC_BUCKET, confirmUpload, createUploadTarget, deleteDocumentAdmin, headObject } from "@/lib/db/admin-documents";
import { runExtraction } from "@/lib/db/admin-doc-extract";
import { listCandidateDocs } from "@/lib/db/admin-doc-search";
import { approveFaqAdmin, confirmFaqReview, countNeedsReview } from "@/lib/db/admin-faq-review";
import { insertUnanswered } from "@/lib/db/unanswered";
import { runChat } from "@/lib/chat/run-chat";
import { defaultDraftDeps } from "@/lib/docs/default-deps";
import { draftForUnanswered } from "@/lib/docs/draft-service";
import { regenerateForFaq } from "@/lib/docs/regenerate";
import { invalidateFaqCache } from "@/lib/search";
import type { DraftDeps, LabeledChunk, RawDraft } from "@/lib/docs/draft";
import { norm } from "@/lib/ingest/evidence";
import { buildDocx } from "@/tests/builders";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

const captured: string[] = [];
for (const level of ["info", "warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[doc-draft]")) captured.push(`${level.toUpperCase()} ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
    else orig(...args);
  };
}

const MIME: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const docIds: string[] = [];
const paths: string[] = [];
const unansweredIds: string[] = [];

async function upload(fileName: string, ext: string, body: Buffer, certType: string, supersedesId?: string) {
  const path = storagePathFor(randomUUID(), ext);
  paths.push(path);
  const t = await createUploadTarget(path);
  const up = await anon.storage.from(DOC_BUCKET).uploadToSignedUrl(t.path, t.token, body, { contentType: MIME[ext] });
  if (up.error) throw up.error;
  const r = await confirmUpload({ path, fileName, certType, category: "procedure", supersedesId }, "verify@example.test", hasCertName);
  if (!r.ok) throw new Error(r.error);
  docIds.push(r.doc.id);
  const ex = await runExtraction(r.doc.id);
  return { doc: r.doc, path, ex };
}

const newUnanswered = async (q: string) => {
  const u = await insertUnanswered(q);
  unansweredIds.push(u.id);
  return u.id;
};
const faqOf = async (uid: string) => ((await sb.from("faq").select("*").eq("source_unanswered_id", uid)).data ?? [])[0];
const approvedCount = async () => (await sb.from("faq").select("id", { count: "exact", head: true }).eq("status", "approved")).count ?? 0;
const restrict = (ids: string[]): DraftDeps => ({ ...defaultDraftDeps, loadDocs: async () => (await listCandidateDocs()).filter((d) => ids.includes(d.id)) });

async function chat(message: string, certType?: string) {
  let route = "";
  let text = "";
  for await (const ev of runChat({ message, certType }, { logChat: async () => ({ id: "x" }), logUnanswered: async () => undefined, hasApprovedFaq: async () => true })) {
    if (ev.type === "meta") route = ev.route;
    if (ev.type === "delta") text += ev.text;
  }
  return { route, text };
}

const docxV = (days: string) =>
  buildDocx([
    { h1: "1. 심사 결과 통보" },
    { p: `비건 인증 심사 결과는 심사 종료 후 ${days} 이내에 신청인에게 서면으로 통보됩니다.` },
    { h1: "2. 이의 제기" },
    { p: "심사 결과에 이의가 있는 경우 통보일로부터 30일 이내에 서면으로 이의를 제기할 수 있습니다." },
  ]);

async function main() {
  const approvedBefore = await approvedCount();
  try {
    // ── TD-01: PDF 절차 → 초안 + 파일·페이지 출처
    const pdf = await upload("인증 절차 안내(TD).pdf", "pdf", readFileSync("tests/fixtures/sample-ko.pdf"), "common");
    check("(준비) PDF 추출 완료", pdf.ex?.ok === true);
    const q1 = await newUnanswered("인증서는 언제 발급되고 유효기간은 어떻게 정해지나요?");
    const r1 = await draftForUnanswered(q1, undefined, restrict([pdf.doc.id]));
    const f1 = await faqOf(q1);
    check("TD-01 PDF 근거 → draft 생성, 출처 파일·페이지(p.3) 기록", r1.status === "drafted" && f1?.status === "draft" && f1.source_doc_id === pdf.doc.id && f1.source_page === 3 && f1.source_evidence.length > 0, `${r1.status} p.${f1?.source_page}`);

    // ── TD-02: 문서에 없는 내용
    const q2 = await newUnanswered("할랄 인증 신청 절차와 필요한 서류를 알려 주세요.");
    const r2 = await draftForUnanswered(q2, undefined, restrict([pdf.doc.id]));
    const f2 = await faqOf(q2);
    check("TD-02 문서에 없음 → 빈 답변 + needs_input + draft, 출처 없음, 사유 기록", ["not_found", "rejected"].includes(r2.status) && f2?.answer === "" && f2.needs_input === true && f2.status === "draft" && f2.source_doc_id === null && !!f2.draft_note, `${r2.status} | ${f2?.draft_note}`);

    // ── 준비: 5일 문서
    const v1 = await upload("심사 결과 통보 안내(TD) v1.docx", "docx", docxV("5일"), "vegan");
    check("(준비) DOCX v1 추출 완료", v1.ex?.ok === true);
    const deps = restrict([v1.doc.id]);

    // ── TD-03: 문서 5일 vs 질문 3일 유도
    captured.length = 0;
    const q3 = await newUnanswered("비건 인증 심사 결과는 심사 종료 후 3일 이내에 통보되는 게 맞나요?");
    const r3 = await draftForUnanswered(q3, "vegan", deps);
    const f3 = await faqOf(q3);
    check("TD-03 문서 5일 / 질문 3일 → 답변에 3일이 들어가지 않음", !/3\s*일/.test(f3?.answer ?? "") && (!f3 || f3.status === "draft"), `${r3.status} | "${(f3?.answer ?? "").slice(0, 50)}"`);
    const pick = (c: LabeledChunk[]) => c.find((x) => norm(x.content).includes(norm("심사 종료 후 5일 이내")))!;
    const forge = (make: (c: LabeledChunk[]) => RawDraft): DraftDeps => ({ ...deps, selectDocs: async (_q, d) => d.map((x) => x.id), generate: async (_q, c) => make(c) });
    captured.length = 0;
    const q3b = await newUnanswered("(강제 주입) 결과 통보 기간");
    const r3b = await draftForUnanswered(
      q3b,
      "vegan",
      forge((c) => ({ found: true, category: "duration", confidence: "high", answer: "심사 결과는 심사 종료 후 3일 이내에 통보됩니다.", evidence: [{ chunk: pick(c).label, quote: "심사 종료 후 5일 이내에 신청인에게 서면으로 통보됩니다" }] })),
    );
    const f3b = await faqOf(q3b);
    check("TD-03 강제 주입(3일) → 근거 검증이 폐기 + 폐기 로그", r3b.status === "rejected" && f3b?.answer === "" && captured.some((l) => l.includes("초안 폐기") && /숫자/.test(l)), `${r3b.status}: ${r3b.reason?.slice(0, 60)}`);

    // ── TD-04 ★: 초안 직후 챗봇은 답하지 않는다
    const qMain = "비건 인증 심사 결과는 심사 종료 후 며칠 이내에 통보되나요?";
    const uMain = await newUnanswered(qMain);
    const rMain = await draftForUnanswered(uMain, "vegan", deps);
    const fMain = await faqOf(uMain);
    check("(준비) 초안 생성, 답변에 5일", rMain.status === "drafted" && fMain.status === "draft" && /5\s*일/.test(fMain.answer), fMain?.answer.slice(0, 50));
    invalidateFaqCache();
    const c4 = await chat(qMain, "vegan");
    check("TD-04 ★ 초안 직후 같은 질문 → 챗봇이 답하지 않음(초안은 검색 대상 아님)", c4.route !== "answered" && !/5\s*일 이내/.test(c4.text), `route=${c4.route} | ${c4.text.slice(0, 60).replace(/\n/g, " ")}`);
    const anonDraft = await anon.from("faq").select("id").eq("id", fMain.id);
    check("TD-04 ★ 익명 클라이언트도 초안 행을 볼 수 없음", (anonDraft.data?.length ?? 0) === 0);

    // ── TD-05: 사람이 승인하면 답한다
    const ap = await approveFaqAdmin(fMain.id, "verify-script");
    invalidateFaqCache();
    const c5 = await chat(qMain, "vegan");
    check("TD-05 승인 후 챗봇이 그 FAQ로 답함(5일)", ap.ok && c5.route === "answered" && /5\s*일/.test(c5.text), `route=${c5.route} | ${c5.text.slice(0, 60).replace(/\n/g, " ")}`);

    // ── TD-06: 개정본 업로드 → 재검토 표시, 기존 답변 계속 서비스
    const reviewBefore = await countNeedsReview();
    const v2 = await upload("심사 결과 통보 안내(TD) v2.docx", "docx", docxV("7일"), "vegan", v1.doc.id);
    check("(준비) v2 추출 완료, version=2", v2.ex?.ok === true && v2.doc.version === 2);
    const fr = (await sb.from("faq").select("*").eq("id", fMain.id).single()).data!;
    check("TD-06 개정 → needs_review=true(revised), status 는 approved 유지", fr.needs_review === true && fr.review_reason === "revised" && fr.status === "approved" && !!fr.review_note && !!fr.review_flagged_at, `${fr.review_reason} | ${fr.review_note}`);
    check("TD-06 재검토 건수 집계 +1", (await countNeedsReview()) === reviewBefore + 1);
    invalidateFaqCache();
    const c6 = await chat(qMain, "vegan");
    check("TD-06 재검토 중에도 챗봇은 기존 답변(5일)을 계속 서비스", c6.route === "answered" && /5\s*일/.test(c6.text), `route=${c6.route}`);
    const reg = await regenerateForFaq(fr as never, restrict([v1.doc.id, v2.doc.id]));
    const newAns = reg.outcome.status === "drafted" ? reg.outcome.draft.answer : "";
    const after = (await sb.from("faq").select("answer,status").eq("id", fMain.id).single()).data!;
    check("TD-06 [새 문서로 초안 다시 만들기] → 새 값(7일) 제시, 기존 FAQ 는 바뀌지 않음", reg.outcome.status === "drafted" && /7\s*일/.test(newAns) && after.answer === fr.answer && after.status === "approved", `${reg.scope} | ${newAns.slice(0, 40)}`);
    await confirmFaqReview(fMain.id, v2.doc.id);
    const cleared = (await sb.from("faq").select("needs_review,review_reason,source_doc_id,status").eq("id", fMain.id).single()).data!;
    check("TD-06 재검토 확정 → 표시 해제, 출처를 v2 로 이전, 승인 유지", cleared.needs_review === false && cleared.review_reason === null && cleared.source_doc_id === v2.doc.id && cleared.status === "approved");
    const del = await deleteDocumentAdmin(v2.doc.id);
    const gone = (await sb.from("faq").select("needs_review,review_reason,review_note,status,source_doc_id").eq("id", fMain.id).single()).data!;
    check("TD-06 출처 문서 삭제 → needs_review=true(deleted, 파일명 기록), 승인 유지", del.ok && gone.needs_review === true && gone.review_reason === "deleted" && gone.status === "approved" && /삭제된 문서/.test(gone.review_note ?? ""), gone.review_note ?? "");

    // ── TD-07: 스캔 PDF
    const scan = await upload("스캔본(TD).pdf", "pdf", readFileSync("tests/fixtures/scanned.pdf"), "common");
    const srow = (await sb.from("documents").select("status,failure_reason").eq("id", scan.doc.id).single()).data!;
    check("TD-07 스캔 PDF → 추출 실패(failed) + 사유, 업로드 파일 유지", scan.ex?.ok === false && srow.status === "failed" && !!srow.failure_reason && !!(await headObject(scan.path)), srow.failure_reason ?? "");

    // ── TD-08: hwp
    const hwp = checkFile("규정.hwp", 1);
    check("TD-08 hwp 거절 + 변환 안내", !hwp.ok && hwp.code === "hwp" && /PDF|DOCX/i.test(hwp.message), hwp.ok ? "" : hwp.message.slice(0, 60));

    // ── TD-09: 익명 접근 차단
    const dl = await anon.storage.from(DOC_BUCKET).download(v1.path);
    const ls = await anon.storage.from(DOC_BUCKET).list();
    const sg = await anon.storage.from(DOC_BUCKET).createSignedUrl(v1.path, 60);
    const dd = await anon.from("documents").select("id").limit(1);
    const dc = await anon.from("document_chunks").select("id").limit(1);
    check("TD-09 익명: 스토리지 다운로드·목록·서명URL 차단", !!dl.error && (ls.data?.length ?? 0) === 0 && !!sg.error, `${dl.error?.message}`);
    check("TD-09 익명: documents / document_chunks 조회 불가", (dd.data?.length ?? 0) === 0 && (dc.data?.length ?? 0) === 0);

    // ── TD-10 ★: 컨설팅성 질문
    for (const q of ["어떻게 하면 비건 인증을 한 번에 통과할 수 있나요?", "심사에서 떨어지지 않으려면 원료 목록을 어떻게 작성해야 하나요? 통과 요령 알려 주세요."]) {
      const id = await newUnanswered(q);
      const r = await draftForUnanswered(id, "vegan", restrict([v1.doc.id, pdf.doc.id]));
      const f = await faqOf(id);
      check(`TD-10 ★ 컨설팅 질문 → 초안 없음: "${q.slice(0, 24)}…"`, r.status === "blocked" && !f, `${r.status} ${r.reason?.slice(0, 40) ?? ""}`);
      const cc = await chat(q, "vegan");
      check("TD-10 ★ 챗봇 경로도 컨설팅 거절", cc.route === "consulting_blocked", cc.route);
    }
    const consultAnswer = "심사를 통과하려면 원료 목록에 인증에 불리한 성분은 빼고 이렇게 작성하시는 것이 좋습니다.";
    check("TD-10 ★ 답변 검사(screenAnswer): 컨설팅 조언 답변은 차단", (await defaultDraftDeps.screenAnswer!(consultAnswer)) === true);
    check("TD-10 ★ 답변 검사: 문서 사실을 옮긴 정상 답변은 통과", (await defaultDraftDeps.screenAnswer!("비건 인증 심사 결과는 심사 종료 후 5일 이내에 서면으로 통보됩니다.")) === false);
    const qf = await newUnanswered("(강제 주입) 원료 목록 작성");
    const rf = await draftForUnanswered(qf, "vegan", {
      ...restrict([pdf.doc.id]),
      screenQuestion: async () => ({ ok: true }),
      selectDocs: async (_q, d) => d.map((x) => x.id),
      generate: async (_q, c) => ({ found: true, category: "document", confidence: "high", answer: consultAnswer, evidence: [{ chunk: c[0].label, quote: c[0].content.slice(0, 20) }] }),
    });
    check("TD-10 ★ 컨설팅 답변이 만들어져도 초안에 남지 않음", rf.status !== "drafted" && (await faqOf(qf))?.answer !== consultAnswer, rf.status);

    // ── 공통
    const { data: made } = await sb.from("faq").select("status").in("source_unanswered_id", unansweredIds);
    const appr = made!.filter((m) => m.status === "approved").length;
    check("자동 생성된 FAQ 중 approved 는 사람이 승인한 1건뿐", appr === 1 && made!.length > 1, `${made?.length}건 중 approved ${appr}`);
  } finally {
    if (unansweredIds.length) {
      await sb.from("faq").delete().in("source_unanswered_id", unansweredIds);
      await sb.from("unanswered").delete().in("id", unansweredIds);
    }
    invalidateFaqCache();
    for (const id of docIds) await sb.from("documents").delete().eq("id", id);
    if (paths.length) await sb.storage.from(DOC_BUCKET).remove(paths);
    const left = (await sb.from("faq").select("id", { count: "exact", head: true }).in("source_unanswered_id", unansweredIds.length ? unansweredIds : [randomUUID()])).count ?? 0;
    const leftDocs = (await sb.from("documents").select("id", { count: "exact", head: true }).in("id", docIds.length ? docIds : [randomUUID()])).count ?? 0;
    const ab = await approvedCount();
    console.log(`정리: 남은 초안 ${left}건, 문서 ${leftDocs}건, 승인 FAQ ${approvedBefore} → ${ab}`);
    if (left > 0 || leftDocs > 0 || ab !== approvedBefore) failed++;
  }
  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("검증 중단:", e);
  process.exit(1);
});
