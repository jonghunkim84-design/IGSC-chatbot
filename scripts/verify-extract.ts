/**
 * Phase 9 검증 (실제 Supabase Storage/DB). 0005 마이그레이션 적용 후 실행.
 * 실행: npm run verify:extract
 *
 * 업로드(서명 URL) → 문서 등록 → runExtraction → doc_chunks / documents 상태를 DB에서 직접 확인한다.
 * 만든 문서·파일·조각은 모두 삭제한다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { hasCertName } from "@/lib/cert-names";
import { storagePathFor } from "@/lib/admin/documents";
import { DOC_BUCKET, confirmUpload, createUploadTarget, deleteDocumentAdmin, getDocument } from "@/lib/db/admin-documents";
import { runExtraction } from "@/lib/db/admin-doc-extract";
import { EXTRACT_MESSAGES } from "@/lib/extract";
import { buildDocx, buildPptx } from "@/tests/builders";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

const fx = (n: string) => readFileSync(`tests/fixtures/${n}`);
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
};

const docIds: string[] = [];
const paths: string[] = [];

/** 관리자 화면과 같은 경로로 업로드 + 등록 */
async function upload(fileName: string, ext: string, body: Buffer) {
  const path = storagePathFor(randomUUID(), ext);
  paths.push(path);
  const t = await createUploadTarget(path);
  const up = await anon.storage.from(DOC_BUCKET).uploadToSignedUrl(t.path, t.token, body, { contentType: MIME[ext] });
  if (up.error) throw up.error;
  const r = await confirmUpload({ path, fileName, certType: "common", category: "procedure" }, "verify@example.test", hasCertName);
  if (!r.ok) throw new Error(r.error);
  docIds.push(r.doc.id);
  return r.doc;
}

async function chunksOf(id: string) {
  const { data, error } = await sb.from("doc_chunks").select("chunk_index, content, page_no, section_title").eq("document_id", id).order("chunk_index");
  if (error) throw error;
  return data ?? [];
}

async function main() {
  try {
    // ── 1. PDF: 청크 생성 + 페이지 번호 + 한글
    const pdf = await upload("인증 절차 안내.pdf", "pdf", fx("sample-ko.pdf"));
    check(`업로드 직후 상태는 pending`, (await getDocument(pdf.id))?.status === "pending");
    const r1 = await runExtraction(pdf.id);
    check(`PDF 추출 성공`, r1.ok, r1.ok ? `${r1.chunks}개` : r1.reason);
    const c1 = await chunksOf(pdf.id);
    const d1 = await getDocument(pdf.id);
    check(`documents: status=extracted, extracted_at·chunk_count 기록, 사유 없음`, d1?.status === "extracted" && !!d1.extracted_at && d1.chunk_count === c1.length && d1.failure_reason === null, `${d1?.status}, ${d1?.chunk_count}`);
    check(`PDF 청크에 페이지 번호(1,2,3) 기록`, JSON.stringify([...new Set(c1.map((c) => c.page_no))]) === "[1,2,3]", JSON.stringify([...new Set(c1.map((c) => c.page_no))]));
    const all = c1.map((c) => c.content).join("\n");
    check(`한글 텍스트가 깨지지 않고 DB 에서 그대로 조회됨`, all.includes("국제지속가능인증원의 인증 절차는 신청, 서류 검토, 심사, 인증 결정의 순서로 진행됩니다") && !/[�-]/.test(all));
    check(`chunk_index 가 0부터 빠짐없이 이어짐`, c1.every((c, i) => c.chunk_index === i));
    check(`조각 길이 ≤ 1300(1200 + 겹침)`, c1.every((c) => c.content.length <= 1300), `최대 ${Math.max(...c1.map((c) => c.content.length))}자`);

    // ── 2. 재추출: 조각 중복 없음
    const r1b = await runExtraction(pdf.id);
    const c1b = await chunksOf(pdf.id);
    check(`재추출 후 조각 수 동일(중복 없음)`, r1b.ok && c1b.length === c1.length, `${c1.length} → ${c1b.length}`);
    check(`재추출 결과 내용도 동일`, JSON.stringify(c1b.map((c) => c.content)) === JSON.stringify(c1.map((c) => c.content)));
    const { count: total } = await sb.from("doc_chunks").select("id", { count: "exact", head: true }).eq("document_id", pdf.id);
    check(`DB 총 행 수 = 조각 수`, total === c1.length, String(total));
    const concurrent = await Promise.all([runExtraction(pdf.id), runExtraction(pdf.id), runExtraction(pdf.id)]);
    const c1c = await chunksOf(pdf.id);
    check(`동시에 3번 재추출해도 중복·오류 없음`, concurrent.every((r) => r.ok) && c1c.length === c1.length && c1c.every((c, i) => c.chunk_index === i), `${c1c.length}개`);

    // ── 3. DOCX: 제목 → section_title, 표는 통째로 한 조각
    const docx = buildDocx([
      { h1: "1. 인증 절차" },
      { p: "신청서를 접수하면 담당자가 내용을 확인합니다." },
      { table: [["단계", "내용", "소요 기간"], ["서류 검토", "제출 자료 확인", "2주"], ["현장 심사", "현장 확인과 기록 검토", "1주"], ["인증 결정", "인증위원회 심의", "1주"]] },
      { h1: "2. 비용" },
      { p: "비용은 담당자 확인 후 확정됩니다." },
    ]);
    const dDocx = await upload("심사 절차서 (개정).docx", "docx", docx);
    const r2 = await runExtraction(dDocx.id);
    const c2 = await chunksOf(dDocx.id);
    const tableChunks = c2.filter((c) => c.content.includes("서류 검토 | 제출 자료 확인 | 2주"));
    check(`DOCX 추출 성공`, r2.ok, r2.ok ? `${r2.chunks}개` : r2.reason);
    check(`DOCX 표가 통째로 한 조각에 들어감(모든 행·열)`, tableChunks.length === 1 && ["현장 확인과 기록 검토", "인증위원회 심의", "소요 기간"].every((s) => tableChunks[0].content.includes(s)));
    check(`DOCX 제목 스타일이 section_title 로 기록됨`, tableChunks[0]?.section_title === "1. 인증 절차" && c2.some((c) => c.section_title === "2. 비용") && c2.every((c) => c.page_no === null));

    // ── 4. 스캔 PDF: failed + 사유, 업로드는 유지
    const scan = await upload("스캔본.pdf", "pdf", fx("scanned.pdf"));
    const r3 = await runExtraction(scan.id);
    const dScan = await getDocument(scan.id);
    check(`스캔 PDF → status=failed`, !r3.ok && dScan?.status === "failed", dScan?.status);
    check(`실패 사유가 안내 문구로 기록됨`, dScan?.failure_reason === "스캔 문서로 보입니다. 텍스트가 있는 원본 파일을 올려주세요." && dScan.failure_reason === EXTRACT_MESSAGES.scanned, dScan?.failure_reason ?? "");
    check(`스캔 PDF: 조각 없음, chunk_count=0`, (await chunksOf(scan.id)).length === 0 && dScan?.chunk_count === 0);
    const { data: still } = await sb.storage.from(DOC_BUCKET).list("", { search: scan.storage_path, limit: 3 });
    check(`추출이 실패해도 업로드(파일·문서 정보)는 유지됨`, !!dScan && !!still?.some((o) => o.name === scan.storage_path));
    const r3b = await runExtraction(scan.id);
    check(`실패한 문서를 다시 실행해도 같은 사유·조각 없음`, !r3b.ok && (await getDocument(scan.id))?.failure_reason === EXTRACT_MESSAGES.scanned);

    // ── 5. 손상된 파일: failed + 사유 (업로드는 유지). 이미 조각이 있던 문서가 실패하면 이전 조각도 남지 않는다.
    //    (스토리지는 같은 경로 덮어쓰기를 캐시할 수 있어, 처음부터 손상된 파일을 올려 확인한다. 운영은 업로드마다 새 경로를 쓴다.)
    const bad = await upload("손상된 파일.pdf", "pdf", Buffer.from("이 파일은 PDF가 아닙니다"));
    const seeded = await sb.rpc("finish_doc_extraction", {
      p_document_id: bad.id,
      p_chunks: [{ chunk_index: 0, content: "이전에 추출된 조각 A", page_no: 1, section_title: null }, { chunk_index: 1, content: "이전에 추출된 조각 B", page_no: 2, section_title: null }],
    });
    check(`(준비) 이 문서에 이전 조각 2개를 미리 저장`, !seeded.error && (await chunksOf(bad.id)).length === 2 && (await getDocument(bad.id))?.status === "extracted");
    const r4 = await runExtraction(bad.id);
    const dBad = await getDocument(bad.id);
    check(`손상된 파일 → failed + '읽을 수 없습니다' 사유`, !r4.ok && dBad?.status === "failed" && (dBad.failure_reason ?? "") === EXTRACT_MESSAGES.corrupt, dBad?.failure_reason ?? "");
    const leftover = (await chunksOf(bad.id)).length;
    check(`실패하면 이전 조각이 남지 않고 chunk_count=0, extracted_at 비움`, leftover === 0 && dBad?.chunk_count === 0 && dBad.extracted_at === null, `남은 조각 ${leftover}개`);
    const { data: badObj } = await sb.storage.from(DOC_BUCKET).list("", { search: bad.storage_path, limit: 3 });
    check(`손상 파일도 업로드(파일·문서 정보)는 유지`, !!badObj?.some((o) => o.name === bad.storage_path));

    // ── 6. 다른 형식
    const xlsx = await upload("비용표.xlsx", "xlsx", fx("sample.xlsx"));
    await runExtraction(xlsx.id);
    const cx = await chunksOf(xlsx.id);
    check(`XLSX: 시트별·헤더 포함 행 단위`, cx.some((c) => c.section_title === "인증 비용" && c.content.includes("인증 종류: 비건 | 항목: 심사비 | 금액: 3000000")) && cx.some((c) => c.section_title === "심사 일정"));
    const pptx = await upload("설명자료.pptx", "pptx", buildPptx([{ title: "인증 절차", paras: ["신청 → 검토 → 심사"] }, { title: "비용", paras: ["담당자 확인"], table: [["항목", "금액"], ["심사비", "확인 중"]] }]));
    await runExtraction(pptx.id);
    const cp = await chunksOf(pptx.id);
    check(`PPTX: 슬라이드 번호가 page_no, 제목이 section_title`, JSON.stringify(cp.map((c) => [c.page_no, c.section_title])) === JSON.stringify([[1, "인증 절차"], [2, "비용"]]));
    const cp949 = await upload("메모장.txt", "txt", fx("sample-cp949.txt"));
    await runExtraction(cp949.id);
    check(`CP949 txt 한글이 깨지지 않음`, (await chunksOf(cp949.id)).map((c) => c.content).join("\n").includes("2. 서류 검토\n부족한 자료는 보완을 요청합니다."));
    const csv = await upload("가격.csv", "csv", Buffer.from("﻿인증,금액\n비건,3000000\n"));
    await runExtraction(csv.id);
    check(`CSV`, (await chunksOf(csv.id))[0]?.content.includes("인증: 비건 | 금액: 3000000"));
    const md = await upload("안내.md", "md", Buffer.from("# 안내\n\n본문입니다.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"));
    await runExtraction(md.id);
    check(`MD: 제목·표`, (await chunksOf(md.id)).some((c) => c.section_title === "안내" && c.content.includes("a | b")));

    // ── 7. 이전 버전(archived)은 재추출하지 않고 조각도 그대로
    // 개정판 업로드 → pdf 는 archived 가 된다
    const revPath = storagePathFor(randomUUID(), "pdf");
    paths.push(revPath);
    const t = await createUploadTarget(revPath);
    await anon.storage.from(DOC_BUCKET).uploadToSignedUrl(t.path, t.token, fx("sample-ko.pdf"), { contentType: "application/pdf" });
    const rev2 = await confirmUpload({ path: revPath, fileName: "인증 절차 안내 v2.pdf", certType: "common", category: "procedure", supersedesId: pdf.id }, "verify@example.test", hasCertName);
    if (rev2.ok) docIds.push(rev2.doc.id);
    const beforeArch = (await chunksOf(pdf.id)).length;
    const r5 = await runExtraction(pdf.id);
    check(`archived 문서는 추출을 거부하고 상태·조각을 바꾸지 않음`, !r5.ok && (await getDocument(pdf.id))?.status === "archived" && (await chunksOf(pdf.id)).length === beforeArch, r5.ok ? "" : r5.reason);
    if (rev2.ok) {
      const r6 = await runExtraction(rev2.doc.id);
      check(`개정판(pending)은 정상 추출`, r6.ok && (await getDocument(rev2.doc.id))?.status === "extracted");
    }

    // ── 8. 접근 제어: 익명은 조각을 읽거나 추출 함수를 호출할 수 없다
    const anonRead = await anon.from("doc_chunks").select("id");
    check(`익명: doc_chunks 조회 불가(행이 있는데도 0건)`, (anonRead.data?.length ?? 0) === 0);
    const anonRpc = await anon.rpc("finish_doc_extraction", { p_document_id: pdf.id, p_chunks: [] });
    check(`익명: 추출 반영 함수 호출 거부`, !!anonRpc.error, anonRpc.error?.message.slice(0, 60) ?? "");
    const anonFail = await anon.rpc("fail_doc_extraction", { p_document_id: pdf.id, p_reason: "x" });
    check(`익명: 실패 기록 함수 호출 거부`, !!anonFail.error);

    // ── 9. 삭제하면 조각도 함께 삭제
    const del = await deleteDocumentAdmin(dDocx.id);
    const { count: left } = await sb.from("doc_chunks").select("id", { count: "exact", head: true }).eq("document_id", dDocx.id);
    check(`문서 삭제 시 조각도 함께 삭제(cascade)`, del.ok && left === 0);
  } finally {
    if (docIds.length) await sb.from("documents").delete().in("id", docIds);
    if (paths.length) await sb.storage.from(DOC_BUCKET).remove(paths);
    const { count: leftDocs } = await sb.from("documents").select("id", { count: "exact", head: true }).in("id", docIds.length ? docIds : [randomUUID()]);
    const { count: leftChunks } = await sb.from("doc_chunks").select("id", { count: "exact", head: true }).in("document_id", docIds.length ? docIds : [randomUUID()]);
    console.log(`정리: 남은 테스트 문서 ${leftDocs ?? 0}건, 조각 ${leftChunks ?? 0}개`);
    if ((leftDocs ?? 0) > 0 || (leftChunks ?? 0) > 0) failed++;
  }
  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("검증 중단:", e);
  process.exit(1);
});
