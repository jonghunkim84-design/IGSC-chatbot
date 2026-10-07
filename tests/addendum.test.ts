/**
 * Phase 12~14 추가 결정 사항 검증:
 *  - 질문·답변 쌍 파서(표 / Q:A: / Q n. 형식)와 원문 그대로 저장
 *  - 질문·답변 문서 처리(컨설팅 제외·중복 검사·길이 제한)
 *  - 파일당 상한 50건, 청크당 최대 3건
 *  - 파일 해시, PDF 추출률(페이지당 50자) 기준
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseQaPairs } from "@/lib/docs/qa-pairs";
import { applyDraftCap, processChunks, processQaPairs, type DocFaqDeps, type DocFaqDoc, type FaqChunk, type RawFaqItem } from "@/lib/docs/doc-faq";
import { CHUNKS_PER_REQUEST, MAX_DRAFTS_PER_DOCUMENT, MAX_FAQ_PER_CHUNK, MSG_PDF_SCANNED, PDF_MIN_CHARS_PER_PAGE } from "@/lib/ingest/config";
import { sha256Hex } from "@/lib/db/admin-documents";
import { sha256File } from "@/lib/admin/file-hash";
import { ExtractError, extractBlocks, extractChunks } from "@/lib/extract";
import type { Block } from "@/lib/extract";

const para = (text: string, page: number | null = null): Block => ({ kind: "para", text, page });

describe("질문·답변 쌍 파서", () => {
  it("2열 표: 왼쪽 질문, 오른쪽 답변 (머리글 행은 건너뜀)", () => {
    const pairs = parseQaPairs([
      { kind: "table", rows: [["질문", "답변"], ["비건 인증이란?", "동물 유래 성분이 없는 제품에 부여합니다."], ["서류는?", "신청서와 제품 목록입니다."]] },
    ]);
    expect(pairs).toEqual([
      { question: "비건 인증이란?", answer: "동물 유래 성분이 없는 제품에 부여합니다.", page: null },
      { question: "서류는?", answer: "신청서와 제품 목록입니다.", page: null },
    ]);
  });

  it("머리글 없는 2열 표도 읽는다. 3열 이상 표는 건너뛴다", () => {
    expect(parseQaPairs([{ kind: "table", rows: [["Q1", "A1"], ["Q2", "A2"]] }])).toHaveLength(2);
    expect(parseQaPairs([{ kind: "table", rows: [["a", "b", "c"], ["d", "e", "f"]] }])).toHaveLength(0);
  });

  it("Q: / A: 표기 (질문이 여러 줄이어도 A: 전까지는 질문)", () => {
    const pairs = parseQaPairs([
      para("Q: 비건 인증은 무엇인가요?\nA: 동물성 성분이 없는 제품에 부여하는 인증입니다.\n추가 설명 줄입니다."),
      para("Q. 인증 기간이\n얼마나 걸리나요?"),
      para("A. 보통 1개월 이내입니다."),
    ]);
    expect(pairs).toEqual([
      { question: "비건 인증은 무엇인가요?", answer: "동물성 성분이 없는 제품에 부여하는 인증입니다.\n추가 설명 줄입니다.", page: null },
      { question: "인증 기간이 얼마나 걸리나요?", answer: "보통 1개월 이내입니다.", page: null },
    ]);
  });

  it("'질문:' / '답변:' 한글 표기도 읽는다", () => {
    const pairs = parseQaPairs([para("질문: 서류는 무엇이 필요한가요?\n답변: 신청서가 필요합니다.")]);
    expect(pairs).toEqual([{ question: "서류는 무엇이 필요한가요?", answer: "신청서가 필요합니다.", page: null }]);
  });

  it("'Q 1.' 머리글만 있는 형식: 답변은 다음 질문 머리글 전까지의 문단들 (원문 그대로)", () => {
    const pairs = parseQaPairs([
      para("Q 1. 어떤 회사인가요?"),
      para("국제지속가능인증원은 인증 서비스를 제공합니다."),
      para("비건, 반려동물, EPD 인증이 있습니다."),
      para("Q 2. 서류는 무엇인가요?"),
      para("신청서입니다."),
    ]);
    expect(pairs).toEqual([
      { question: "어떤 회사인가요?", answer: "국제지속가능인증원은 인증 서비스를 제공합니다.\n비건, 반려동물, EPD 인증이 있습니다.", page: null },
      { question: "서류는 무엇인가요?", answer: "신청서입니다.", page: null },
    ]);
  });

  it("스프레드시트·CSV 두 열 한 줄 형식", () => {
    const pairs = parseQaPairs([
      { kind: "heading", text: "Sheet1", level: 1 },
      para("질문: 비용은 얼마인가요? | 답변: 견적서로 안내합니다."),
      para("질문: 서류는? | 답변: 신청서 | 비고: 참고"),
    ]);
    expect(pairs).toEqual([{ question: "비용은 얼마인가요?", answer: "견적서로 안내합니다.", page: null }]); // 3열 행은 2열 표가 아니라 제외
  });

  it("PDF·슬라이드의 쪽 번호를 이어받는다", () => {
    expect(parseQaPairs([para("Q: 질문입니다?\nA: 답입니다.", 3)])[0].page).toBe(3);
  });

  it("Q 로 시작하는 일반 단어는 질문 머리글이 아니다", () => {
    expect(parseQaPairs([para("Quality 인증 안내문입니다."), para("Question 항목 설명")])).toEqual([]);
  });

  const customerDocx = "docs/customer-files/IGSC AI 챗봇 구축 요청 서류_261002/1. FAQ자료/Q&A_IGSC_261001.docx";
  it.skipIf(!existsSync(customerDocx))("실제 고객 Q&A docx에서 47건을 원문 그대로 읽는다", async () => {
    const blocks = await extractBlocks(new Uint8Array(readFileSync(customerDocx)), "docx");
    const pairs = parseQaPairs(blocks);
    expect(pairs.length).toBe(47);
    expect(pairs[0].question).toContain("어떤 회사이며");
    expect(pairs[0].answer).toContain("국제지속가능인증원은 국제적으로 통용가능한 인증 서비스를 제공하고 있는 기관으로");
    expect(pairs.every((p) => p.answer.length > 0)).toBe(true);
  });
});

const doc: DocFaqDoc = { id: "d1", file_name: "문의 응대.docx", cert_type: "vegan", doc_category: "policy", status: "extracted", doc_format: "qa_pairs" };
const deps = (over: Partial<DocFaqDeps> = {}): DocFaqDeps => ({
  extract: vi.fn(async () => []),
  isDuplicate: vi.fn(async () => ({ duplicate: false })),
  classifyQa: vi.fn(async (pairs) => pairs.map(() => ({ category: "document" as const, consulting: false }))),
  ...over,
});

describe("질문·답변 문서 처리 (processQaPairs)", () => {
  const pairs = [
    { question: "비건 인증 서류는 무엇인가요?", answer: "신청서와 제품 목록이 필요합니다.\n사업자 등록증도 제출합니다.", page: null },
  ];

  it("질문·답변은 원문 그대로, evidence 는 질문·답변 쌍 자체, 인증 종류는 문서 값을 상속한다", async () => {
    const r = await processQaPairs(pairs, doc, [], deps());
    expect(r.drafts).toHaveLength(1);
    const d = r.drafts[0];
    expect(d.question).toBe(pairs[0].question);
    expect(d.answer).toBe(pairs[0].answer);
    expect(d.source_evidence).toEqual([`${pairs[0].question}\n${pairs[0].answer}`]);
    expect(d.cert_type).toBe("vegan");
    expect(d.category).toBe("document"); // AI 판정
    expect(d.needs_input).toBe(false);
  });

  it("컨설팅성 쌍은 탈락한다 (AI 판정 / 질문 표현)", async () => {
    const r1 = await processQaPairs(pairs, doc, [], deps({ classifyQa: vi.fn(async () => [{ category: "scope" as const, consulting: true }]) }));
    expect(r1.drafts).toHaveLength(0);
    expect(r1.rejected[0]).toMatchObject({ stage: "consulting" });
    const r2 = await processQaPairs([{ question: "어떻게 하면 비건 인증을 통과하나요?", answer: "성분표를 정리하세요.", page: null }], doc, [], deps());
    expect(r2.rejected[0]).toMatchObject({ stage: "consulting" });
  });

  it("같은 인증 종류에 같은 질문이 있으면 중복으로 탈락, 다른 인증 종류면 중복이 아니다", async () => {
    const same = await processQaPairs(pairs, doc, [{ id: "f1", cert_type: "vegan", question: pairs[0].question }], deps());
    expect(same.rejected[0]).toMatchObject({ stage: "duplicate", faq_id: "f1" });
    const other = await processQaPairs(pairs, doc, [{ id: "f2", cert_type: "organic", question: pairs[0].question }], deps());
    expect(other.drafts).toHaveLength(1);
  });

  it("의미가 같은 질문은 중복 검사로 탈락하고 겹치는 FAQ id 가 남는다", async () => {
    const d = deps({ isDuplicate: vi.fn(async () => ({ duplicate: true, of: "비건 서류?", id: "f9" })) });
    const r = await processQaPairs(pairs, doc, [], d);
    expect(r.rejected[0]).toMatchObject({ stage: "duplicate", faq_id: "f9" });
  });

  it("답변이 비었거나 길이 제한을 넘으면 원문을 고치지 않고 탈락한다", async () => {
    const r = await processQaPairs(
      [
        { question: "답이 없는 질문인가요?", answer: "", page: null },
        { question: "가".repeat(301), answer: "답", page: null },
        { question: "답이 너무 긴 질문인가요?", answer: "가".repeat(3001), page: null },
      ],
      doc,
      [],
      deps(),
    );
    expect(r.drafts).toHaveLength(0);
    expect(r.rejected.map((x) => x.stage)).toEqual(["format", "format", "format"]);
  });

  it("분류에 실패하면 모두 처리 실패로 남기고 아무것도 만들지 않는다", async () => {
    const r = await processQaPairs(pairs, doc, [], deps({ classifyQa: vi.fn(async () => Promise.reject(new Error("api down"))) }));
    expect(r.drafts).toHaveLength(0);
    expect(r.rejected[0].stage).toBe("error");
  });
});

describe("파일당 상한·청크당 상한", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `질문 ${i}`, source_page: i, variants: [], answer: "a", category: "scope" as const, cert_type: "vegan", source_doc_id: "d", source_evidence: [], needs_input: false, draft_note: "" }));

  it(`상한 ${MAX_DRAFTS_PER_DOCUMENT}건: 넘치는 초안은 저장하지 않고 탈락(limit)에 남기며 작업을 중단 표시한다`, () => {
    const r = applyDraftCap(MAX_DRAFTS_PER_DOCUMENT - 2, mk(5), 10, 40);
    expect(r.keep).toHaveLength(2);
    expect(r.cut).toHaveLength(3);
    expect(r.cut[0].stage).toBe("limit");
    expect(r.limitReached).toBe(true);
  });

  it("상한에 정확히 도달했고 남은 구간이 있으면 중단(limitReached)", () => {
    expect(applyDraftCap(MAX_DRAFTS_PER_DOCUMENT - 3, mk(3), 10, 40).limitReached).toBe(true);
  });

  it("상한에 도달해도 문서 끝까지 다 처리했고 넘친 것이 없으면 중단 표시를 하지 않는다", () => {
    expect(applyDraftCap(MAX_DRAFTS_PER_DOCUMENT - 3, mk(3), 40, 40).limitReached).toBe(false);
  });

  it("상한 미만이면 그대로 통과", () => {
    const r = applyDraftCap(10, mk(4), 5, 40);
    expect(r.keep).toHaveLength(4);
    expect(r.limitReached).toBe(false);
  });

  it("청크당 최대 3건만 본다 (모델이 더 많이 내도)", async () => {
    const chunk: FaqChunk = { page_no: 1, section_title: null, content: "문장 하나 둘 셋 넷 다섯" };
    const items: RawFaqItem[] = Array.from({ length: 6 }, (_, i) => ({ question: `질문 ${i}번인가요?`, variants: [], answer: "문장", category: "scope", evidence: ["문장 하나 둘"], kind: "igsc" }));
    const d: DocFaqDeps = { extract: vi.fn(async () => items), isDuplicate: vi.fn(async () => ({ duplicate: false })) };
    const r = await processChunks([chunk], { ...doc, doc_format: "narrative" }, [], d);
    expect(r.drafts.length).toBeLessThanOrEqual(MAX_FAQ_PER_CHUNK);
    expect(MAX_FAQ_PER_CHUNK).toBe(3);
  });

  it("한 요청에서 청크 5개씩 처리한다 (설정값)", () => expect(CHUNKS_PER_REQUEST).toBe(5));
});

describe("파일 해시", () => {
  it("서버(Node)와 브라우저(WebCrypto) 해시가 같다 — 같은 파일은 같은 값", async () => {
    const bytes = new TextEncoder().encode("같은 내용의 파일");
    const file = new File([bytes], "a.txt");
    expect(await sha256File(file)).toBe(sha256Hex(bytes));
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("내용이 다르면 해시가 다르다 (파일명이 같아도)", () => {
    expect(sha256Hex(new TextEncoder().encode("버전 1"))).not.toBe(sha256Hex(new TextEncoder().encode("버전 2")));
  });
});

describe("PDF 추출률 기준 (페이지당 평균 50자 미만이면 실패)", () => {
  const dir = "docs/customer-files/IGSC AI 챗봇 구축 요청 서류_261002/3. 인증자료-인증절차, 필요서류";
  const scanned = `${dir}/JAS 인증절차_소개자료.pdf`;
  const textual = `${dir}/인증별 필요서류/반려동물 인증의 필요 서류v1.pdf`;

  it("기준값은 설정 파일의 상수다", () => expect(PDF_MIN_CHARS_PER_PAGE).toBe(50));

  it.skipIf(!existsSync(scanned))("글자가 없는 이미지 PDF 는 안내 문구와 함께 실패한다", async () => {
    const err = await extractChunks(new Uint8Array(readFileSync(scanned)), "pdf").catch((e) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect((err as ExtractError).code).toBe("scanned");
    expect((err as ExtractError).message).toBe(MSG_PDF_SCANNED);
    expect(MSG_PDF_SCANNED).toContain("스캔 문서로 보입니다");
    expect(MSG_PDF_SCANNED).toContain("텍스트가 있는 원본 파일을 올려 주세요");
  });

  it.skipIf(!existsSync(textual))("텍스트가 있는 PDF 는 통과한다", async () => {
    const chunks = await extractChunks(new Uint8Array(readFileSync(textual)), "pdf");
    expect(chunks.length).toBeGreaterThan(0);
  });
});
