/**
 * Phase 8 검증 (실제 Supabase Storage/DB). 0004 마이그레이션 적용 후 실행.
 * 실행: npm run verify:documents
 *
 * 브라우저 업로드 흐름(서버가 서명 URL 발급 → 익명 키 클라이언트가 토큰으로 직접 업로드 → 서버가 확인·등록)을 그대로 재현한다.
 * 만든 문서·파일은 모두 삭제한다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { hasCertName } from "@/lib/cert-names";
import { checkFile, storagePathFor } from "@/lib/admin/documents";
import {
  DOC_BUCKET,
  confirmUpload,
  createDownloadUrl,
  createUploadTarget,
  deleteDocumentAdmin,
  getDocument,
  headObject,
  listDocuments,
} from "@/lib/db/admin-documents";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
};

// ── 테스트용 파일 내용 ─────────────────────────────────────────
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 압축 없는(stored) 최소 ZIP — docx 컨테이너용 */
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const docx = (text: string) =>
  zip([
    { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: "_rels/.rels", data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: "word/document.xml", data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`) },
  ]);

// ── 브라우저가 하는 일을 재현: 서버가 준 서명 토큰으로 익명 클라이언트가 직접 업로드 ─────────
const createdPaths: string[] = [];
const createdDocs: string[] = [];

async function browserUpload(ext: string, body: Buffer, contentType: string) {
  const path = storagePathFor(randomUUID(), ext);
  createdPaths.push(path);
  const target = await createUploadTarget(path);
  const { error } = await anon.storage.from(DOC_BUCKET).uploadToSignedUrl(target.path, target.token, body, { contentType });
  return { path, error };
}

async function main() {
  const email = "verify@example.test";
  const nameA = "인증 절차서 (개정) 최종본.pdf";
  const nameB = "비건 심사 안내 v1.docx";

  try {
    // ── 1. PDF 와 docx 업로드 → 목록에 표시, 한글·공백 파일명 유지
    const pdf = await browserUpload("pdf", PDF, checkFile(nameA, PDF.length).ok ? "application/pdf" : "");
    check(`PDF 업로드(서명 URL 직접 업로드)`, !pdf.error, pdf.error?.message ?? "");
    const rA = await confirmUpload({ path: pdf.path, fileName: nameA, certType: "vegan", category: "procedure" }, email, hasCertName);
    check(`PDF 문서 등록`, rA.ok, rA.ok ? `v${rA.doc.version} / ${rA.doc.status}` : rA.error);
    const dA = rA.ok ? rA.doc : null;
    if (dA) createdDocs.push(dA.id);

    const dx = docx("비건 인증 심사 안내");
    const up2 = await browserUpload("docx", dx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    check(`DOCX 업로드`, !up2.error, up2.error?.message ?? "");
    const rB = await confirmUpload({ path: up2.path, fileName: nameB, certType: "organic", category: "policy" }, email, hasCertName);
    const dB = rB.ok ? rB.doc : null;
    if (dB) createdDocs.push(dB.id);
    check(`DOCX 문서 등록`, rB.ok, rB.ok ? "" : rB.error);

    const list = await listDocuments({});
    const ids = new Set(list.rows.map((r) => r.id));
    check(`목록에 PDF·DOCX 표시`, !!dA && !!dB && ids.has(dA.id) && ids.has(dB.id), `전체 ${list.total}건`);
    check(`한글·공백 파일명이 그대로 저장·조회됨`, dA?.file_name === nameA && list.rows.find((r) => r.id === dB?.id)?.file_name === nameB, dA?.file_name ?? "");
    check(`기본값: status=pending, version=1, 인증 종류·분류·업로더`, dA?.status === "pending" && dA.version === 1 && dA.cert_type === "vegan" && dA.doc_category === "procedure" && dA.uploaded_by === email && dA.supersedes === null);
    check(`저장 경로는 uuid 기반(파일명과 무관)`, !!dA && /^[0-9a-f-]{36}\.pdf$/.test(dA.storage_path) && !dA.storage_path.includes("절차"));
    check(`서버가 확인한 크기·형식 저장`, dA?.file_size === PDF.length && dA.mime_type === "application/pdf", `${dA?.file_size}B`);

    // ── 2. 다운로드: 서명 URL(짧은 유효기간), 내용 일치, 한글 파일명으로 내려받기
    if (dA) {
      const signed = await createDownloadUrl(dA);
      const res = await fetch(signed);
      const bytes = Buffer.from(await res.arrayBuffer());
      check(`다운로드 서명 URL 로 원본 내용 수신`, res.status === 200 && bytes.equals(PDF), `${res.status}, ${bytes.length}B`);
      const cd = res.headers.get("content-disposition") ?? "";
      let decoded = "";
      try {
        decoded = decodeURIComponent(cd);
      } catch {
        decoded = cd;
      }
      check(`다운로드 파일명이 한글 원본명으로 지정됨`, decoded.includes(nameA), cd.slice(0, 90));
      const exp = /[?&]token=([^&]+)/.exec(signed)?.[1] ?? "";
      const payload = exp ? JSON.parse(Buffer.from(exp.split(".")[1], "base64url").toString()) : {};
      const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : NaN;
      check(`서명 URL 유효기간이 짧음(60초 이내)`, ttl > 0 && ttl <= 60, `${ttl}초`);
    }

    // ── 3. 익명 키로는 버킷 접근 불가
    if (dA) {
      const l = await anon.storage.from(DOC_BUCKET).list("");
      check(`익명: 파일 목록 조회 → 비어 있음/거부`, (l.data?.length ?? 0) === 0);
      const s = await anon.storage.from(DOC_BUCKET).createSignedUrl(dA.storage_path, 60);
      check(`익명: 서명 URL 발급 거부`, !!s.error && !s.data);
      const dl = await anon.storage.from(DOC_BUCKET).download(dA.storage_path);
      check(`익명: 파일 내려받기 거부`, !!dl.error && !dl.data);
      const pub = await fetch(`${url}/storage/v1/object/public/${DOC_BUCKET}/${dA.storage_path}`);
      check(`공개 URL 로 접근 불가(비공개 버킷)`, pub.status >= 400, String(pub.status));
      const put = await anon.storage.from(DOC_BUCKET).upload(storagePathFor(randomUUID(), "pdf"), PDF, { contentType: "application/pdf" });
      check(`익명: 토큰 없이 업로드 거부`, !!put.error, put.error?.message ?? "");
      const t = await anon.from("documents").select("id");
      check(`익명: documents 테이블 행 조회 불가(행이 있는데도 0건)`, (t.data?.length ?? 0) === 0);
    }

    // ── 4. 형식·크기 규칙
    for (const n of ["신청서.hwp", "신청서.hwpx"]) {
      const c = checkFile(n, 1000);
      check(`${n} 거부 + PDF 안내`, !c.ok && c.code === "hwp" && c.message.includes("PDF"));
    }
    const hwpPath = `${randomUUID()}.hwp`;
    const hwpConfirm = await confirmUpload({ path: hwpPath, fileName: "x.hwp", certType: "common", category: "other" }, email, hasCertName);
    check(`서버 등록 단계에서도 hwp 경로 거부`, !hwpConfirm.ok);
    const big = await browserUpload("pdf", Buffer.alloc(21 * 1024 * 1024, 1), "application/pdf");
    check(`20MB 초과 파일은 스토리지가 거부`, !!big.error, big.error?.message.slice(0, 60) ?? "");
    const badType = await browserUpload("pdf", PDF, "application/x-msdownload");
    check(`허용되지 않은 Content-Type 은 스토리지가 거부`, !!badType.error, badType.error?.message.slice(0, 60) ?? "");

    // ── 5. 등록 단계 방어
    const ghost = await confirmUpload({ path: `${randomUUID()}.pdf`, fileName: "없는파일.pdf", certType: "common", category: "other" }, email, hasCertName);
    check(`업로드되지 않은 경로는 등록 거부`, !ghost.ok);
    const mism = await browserUpload("pdf", PDF, "application/pdf");
    const rMism = await confirmUpload({ path: mism.path, fileName: "위장.docx", certType: "common", category: "other" }, email, hasCertName);
    check(`확장자 불일치 등록 거부 + 올라간 파일 정리`, !rMism.ok && (await headObject(mism.path)) === null);
    const badCert = await browserUpload("pdf", PDF, "application/pdf");
    const rBadCert = await confirmUpload({ path: badCert.path, fileName: "a.pdf", certType: "no-such-cert", category: "other" }, email, hasCertName);
    check(`알 수 없는 인증 종류 거부 + 파일 정리`, !rBadCert.ok && (await headObject(badCert.path)) === null);

    // ── 6. 개정판: version+1, supersedes 연결, 이전 버전 archived
    if (dA) {
      const v2f = await browserUpload("pdf", Buffer.concat([PDF, Buffer.from("\n% v2\n")]), "application/pdf");
      const r2 = await confirmUpload({ path: v2f.path, fileName: "인증 절차서 (개정) 최종본 v2.pdf", certType: "common", category: "other", supersedesId: dA.id }, email, hasCertName);
      const d2 = r2.ok ? r2.doc : null;
      if (d2) createdDocs.push(d2.id);
      check(`개정판 등록: version=2, supersedes=이전 문서`, !!d2 && d2.version === 2 && d2.supersedes === dA.id, r2.ok ? "" : r2.error);
      check(`개정판은 이전 문서의 인증 종류·분류를 이어받음`, d2?.cert_type === "vegan" && d2.doc_category === "procedure");
      const prev = await getDocument(dA.id);
      check(`이전 버전 status 가 archived 로 변경됨`, prev?.status === "archived");
      check(`새 버전은 pending`, d2?.status === "pending");

      const v3bad = await browserUpload("pdf", PDF, "application/pdf");
      const rBad = await confirmUpload({ path: v3bad.path, fileName: "다시개정.pdf", certType: "common", category: "other", supersedesId: dA.id }, email, hasCertName);
      check(`이미 개정된(archived) 문서를 다시 개정 → 거부 + 파일 정리`, !rBad.ok && (await headObject(v3bad.path)) === null, rBad.ok ? "" : rBad.error);

      if (d2) {
        const v3f = await browserUpload("pdf", PDF, "application/pdf");
        const r3 = await confirmUpload({ path: v3f.path, fileName: "인증 절차서 v3.pdf", certType: "common", category: "other", supersedesId: d2.id }, email, hasCertName);
        const d3 = r3.ok ? r3.doc : null;
        if (d3) createdDocs.push(d3.id);
        check(`두 번째 개정: version=3, 연결·보관 체인`, !!d3 && d3.version === 3 && d3.supersedes === d2.id && (await getDocument(d2.id))?.status === "archived");

        // ── 7. 삭제: 스토리지와 테이블 함께
        if (d3) {
          const del = await deleteDocumentAdmin(d3.id);
          check(`삭제: 성공`, del.ok);
          check(`삭제: DB 행 제거`, (await getDocument(d3.id)) === null);
          check(`삭제: 스토리지 파일 제거`, (await headObject(d3.storage_path)) === null);
        }
        const d2after = await getDocument(d2.id);
        check(`삭제 후 남은 문서는 그대로(다른 버전 영향 없음)`, !!d2after && d2after.version === 2);
      }
    }
    const missing = await deleteDocumentAdmin(randomUUID());
    check(`없는 문서 삭제 → 오류 안내`, !missing.ok);
  } finally {
    // 정리: 이 스크립트가 만든 문서 행과 스토리지 파일 전부 삭제
    if (createdDocs.length) await sb.from("documents").delete().in("id", createdDocs);
    if (createdPaths.length) await sb.storage.from(DOC_BUCKET).remove(createdPaths);
    const left = await sb.from("documents").select("id", { count: "exact", head: true }).in("id", createdDocs.length ? createdDocs : [randomUUID()]);
    let objLeft = 0;
    for (const p of createdPaths) if (await headObject(p)) objLeft++;
    console.log(`정리: 남은 테스트 문서 ${left.count ?? 0}건, 남은 테스트 파일 ${objLeft}개`);
    if ((left.count ?? 0) > 0 || objLeft > 0) failed++;
  }

  console.log(failed === 0 ? "\n모두 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("검증 중단:", e);
  process.exit(1);
});
