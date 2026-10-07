/** Phase 9 텍스트 추출·청크 분할 테스트 (API 호출 없음, 실제 PDF/XLSX 파일과 코드로 만든 DOCX/PPTX 사용) */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHUNK_MAX, CHUNK_OVERLAP, chunkBlocks, splitLongText } from "@/lib/extract/chunk";
import { ExtractError, extractChunks, EXTRACT_MESSAGES } from "@/lib/extract";
import { cleanText, decodeBytes, looksGarbled } from "@/lib/extract/text";
import { parseCsv } from "@/lib/extract/sheet";
import type { Block } from "@/lib/extract/types";
import { buildDocx, buildPptx } from "./builders";

const fx = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const KO_SENTENCE = "국제지속가능인증원은 신청 내용을 확인하고 필요한 경우 보완을 요청합니다. ";

describe("청크 분할 규칙", () => {
  it("문단 경계 기준으로 묶고 1200자를 넘기지 않는다 (겹침 100자 제외)", () => {
    const paras: Block[] = Array.from({ length: 30 }, (_, i) => ({ kind: "para", text: `문단 ${i + 1}. ${KO_SENTENCE.repeat(3)}` }));
    const chunks = chunkBlocks(paras);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(CHUNK_MAX + CHUNK_OVERLAP + 2);
    // 마지막을 뺀 조각은 800자 이상으로 채운다
    for (const c of chunks.slice(0, -1)) expect(c.content.length).toBeGreaterThanOrEqual(800);
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });

  it("이어지는 조각은 앞 조각의 끝 100자를 겹쳐 시작한다", () => {
    const paras: Block[] = Array.from({ length: 12 }, (_, i) => ({ kind: "para", text: `문단 ${i + 1}. ${KO_SENTENCE.repeat(3)}` }));
    const chunks = chunkBlocks(paras);
    expect(chunks.length).toBeGreaterThan(1);
    const prevTail = chunks[0].content.slice(-CHUNK_OVERLAP);
    const head = chunks[1].content.slice(0, CHUNK_OVERLAP + 40);
    // 겹침은 단어 경계로 맞춰 자르므로 끝 100자 중 뒤쪽 절반은 반드시 다음 조각 앞부분에 있다
    expect(head).toContain(prevTail.slice(-50).trim());
  });

  it("1200자를 넘는 긴 문단은 문장 경계에서 나누고 조각 사이를 겹친다", () => {
    const long = KO_SENTENCE.repeat(60); // 약 3000자
    const pieces = splitLongText(long);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(CHUNK_MAX);
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i - 1].slice(-40).trim().length).toBeGreaterThan(0);
      expect(pieces[i]).toContain(pieces[i - 1].slice(-30).trim().split(" ").slice(-2).join(" "));
    }
    expect(pieces.every((p) => /[.요다]$/.test(p) || p === pieces[pieces.length - 1])).toBe(true);
  });

  it("제목·페이지가 바뀌면 조각을 끊고 section_title/page_no 를 정확히 기록한다", () => {
    const chunks = chunkBlocks([
      { kind: "heading", text: "1. 신청", level: 1 },
      { kind: "para", text: "신청서를 접수합니다." },
      { kind: "heading", text: "2. 심사", level: 1 },
      { kind: "para", text: "현장 심사를 실시합니다." },
      { kind: "para", text: "슬라이드 3 내용", page: 3 },
    ]);
    expect(chunks.map((c) => c.section_title)).toEqual(["1. 신청", "2. 심사", "2. 심사"]);
    expect(chunks.map((c) => c.page_no)).toEqual([null, null, 3]);
    expect(chunks[0].content).toContain("1. 신청"); // 제목이 내용에도 포함
    expect(chunks[1].content).not.toContain("신청서를 접수합니다");
  });

  it("제목 바로 뒤에 긴 문단이 와도 제목만 따로 남지 않는다", () => {
    const chunks = chunkBlocks([{ kind: "heading", text: "긴 절", level: 1 }, { kind: "para", text: KO_SENTENCE.repeat(50) }]);
    expect(chunks[0].content.startsWith("긴 절")).toBe(true);
    expect(chunks[0].content.length).toBeGreaterThan(500);
  });

  it("표는 쪼개지 않는다: 1200자 이하는 통째로 한 조각, 6000자 이하도 통째로", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => [`항목 ${i + 1}`, "심사비", "3,000,000원", "제품 수에 따라 변동됩니다"]);
    const small = chunkBlocks([{ kind: "table", rows: [["구분", "항목", "금액", "비고"], ...rows(8)] }]);
    expect(small).toHaveLength(1);
    expect(small[0].content.split("\n")).toHaveLength(9);

    const medium = chunkBlocks([{ kind: "para", text: "앞 문단입니다." }, { kind: "table", rows: [["구분", "항목", "금액", "비고"], ...rows(60)] }, { kind: "para", text: "뒤 문단입니다." }]);
    const tableChunk = medium.find((c) => c.content.includes("항목 60"))!;
    expect(tableChunk.content).toContain("항목 1 |"); // 처음부터 끝까지 한 조각
    expect(tableChunk.content).toContain("구분 | 항목 | 금액 | 비고");
    expect(tableChunk.content.length).toBeGreaterThan(CHUNK_MAX);
    expect(medium.filter((c) => c.content.includes("항목 ")).length).toBe(1);
  });

  it("6000자를 넘는 표만 행 단위로 나누고 머리글 행을 반복한다", () => {
    const rows = Array.from({ length: 300 }, (_, i) => [`항목 ${i + 1}`, "심사비", "3,000,000원", "제품 수에 따라 변동됩니다"]);
    const chunks = chunkBlocks([{ kind: "table", rows: [["구분", "항목", "금액", "비고"], ...rows] }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.startsWith("구분 | 항목 | 금액 | 비고")).toBe(true);
    expect(chunks.map((c) => c.content).join("\n")).toContain("항목 300");
  });

  it("행 단위(atomic) 문단은 겹침 없이 행 경계에서만 끊는다", () => {
    const rowsB: Block[] = Array.from({ length: 40 }, (_, i) => ({ kind: "para", atomic: true, text: `인증 종류: 비건 | 항목: 심사비 ${i + 1} | 금액: 3000000 | 비고: 제품 수에 따라 변동` }));
    const chunks = chunkBlocks(rowsB);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) for (const line of c.content.split("\n\n")) expect(line).toMatch(/^인증 종류: 비건 \| 항목: 심사비 \d+ \| 금액: 3000000 \| 비고: 제품 수에 따라 변동$/);
  });
});

describe("텍스트 정리", () => {
  it("NUL·제어문자 제거, NFD→NFC, 공백 정리", () => {
    expect(cleanText("가\u0000나\u0007다")).toBe("가나다");
    expect(cleanText("한글".normalize("NFD"))).toBe("한글");
    expect(cleanText("a   b\t\tc\n\n\n\nd")).toBe("a b c\n\nd");
  });
  it("깨진 글자 판별", () => {
    expect(looksGarbled("�������������������������")).toBe(true);
    expect(looksGarbled("정상적인 한글 문장입니다. 글자가 깨지지 않았습니다.")).toBe(false);
  });
  it("UTF-8(BOM 포함)과 CP949 텍스트를 모두 올바르게 읽는다", () => {
    expect(decodeBytes(fx("sample-utf8.txt")).startsWith("인증 절차 안내")).toBe(true);
    expect(decodeBytes(fx("sample-cp949.txt")).startsWith("인증 절차 안내")).toBe(true);
  });
  it("CSV 파서: 따옴표·쉼표·줄바꿈", () => {
    expect(parseCsv('a,b\n"x,1","y ""q"""\n"줄\n바꿈",z')).toEqual([["a", "b"], ["x,1", 'y "q"'], ["줄\n바꿈", "z"]]);
  });
});

describe("PDF", () => {
  it("텍스트를 추출하고 페이지 번호를 기록한다 (한글 유지)", async () => {
    const chunks = await extractChunks(fx("sample-ko.pdf"), "pdf");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const pages = [...new Set(chunks.map((c) => c.page_no))];
    expect(pages).toEqual([1, 2, 3]);
    const all = chunks.map((c) => c.content).join("\n");
    expect(all).toContain("국제지속가능인증원의 인증 절차는 신청, 서류 검토, 심사, 인증 결정의 순서로 진행됩니다");
    expect(all).toContain("igsc@igsc.kr");
    expect(all).not.toMatch(/[�-]/); // 깨진 글자 없음
    // 조각은 페이지를 넘지 않는다: 1페이지 조각에는 3페이지 문구가 없다
    expect(chunks.filter((c) => c.page_no === 1).some((c) => c.content.includes("인증서 발급"))).toBe(false);
    expect(chunks.filter((c) => c.page_no === 3).some((c) => c.content.includes("인증서 발급"))).toBe(true);
  });
  it("긴 페이지(2쪽)는 여러 조각으로 나뉘고 서로 겹친다", async () => {
    const p2 = (await extractChunks(fx("sample-ko.pdf"), "pdf")).filter((c) => c.page_no === 2);
    expect(p2.length).toBeGreaterThanOrEqual(2);
    for (const c of p2) expect(c.content.length).toBeLessThanOrEqual(CHUNK_MAX + CHUNK_OVERLAP + 2);
  });
  it("스캔 PDF(텍스트 레이어 없음)는 안내 사유와 함께 실패한다", async () => {
    await expect(extractChunks(fx("scanned.pdf"), "pdf")).rejects.toMatchObject({ name: "ExtractError", code: "scanned", message: "텍스트가 거의 추출되지 않았습니다. 스캔 문서로 보입니다. 텍스트가 있는 원본 파일을 올려 주세요" });
  });
  it("손상된 PDF", async () => {
    await expect(extractChunks(new Uint8Array([1, 2, 3, 4]), "pdf")).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("DOCX", () => {
  const docx = buildDocx([
    { h1: "1. 인증 절차" },
    { p: "신청서를 접수하면 담당자가 내용을 확인합니다." },
    { table: [["단계", "내용", "소요 기간"], ["서류 검토", "제출 자료 확인", "2주"], ["현장 심사", "현장 확인과 기록 검토", "1주"], ["인증 결정", "인증위원회 심의", "1주"]] },
    { p: "표 아래 문단입니다." },
    { h1: "2. 비용" },
    { h2: "2-1. 심사비" },
    { p: "비용은 담당자 확인 후 확정됩니다." },
  ]);
  it("제목 스타일이 section_title 이 되고, 표는 통째로 한 조각에 들어간다", async () => {
    const chunks = await extractChunks(new Uint8Array(docx), "docx");
    expect(chunks.every((c) => c.page_no === null)).toBe(true);
    const t = chunks.find((c) => c.content.includes("서류 검토"))!;
    expect(t.section_title).toBe("1. 인증 절차");
    for (const cell of ["단계", "내용", "소요 기간", "서류 검토", "제출 자료 확인", "현장 심사", "현장 확인과 기록 검토", "인증 결정", "인증위원회 심의", "2주", "1주"]) {
      expect(t.content, cell).toContain(cell);
    }
    expect(t.content).toContain("서류 검토 | 제출 자료 확인 | 2주"); // 행 구조 유지
    expect(chunks.filter((c) => c.content.includes("현장 확인과 기록 검토"))).toHaveLength(1); // 표가 쪼개지지 않음
    expect(chunks.map((c) => c.section_title)).toContain("2-1. 심사비");
  });
  it("손상된 DOCX", async () => {
    await expect(extractChunks(new Uint8Array([80, 75, 3, 4, 0, 0]), "docx")).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("XLSX / CSV", () => {
  it("시트별로, 헤더를 포함한 행 단위 텍스트로 변환한다 (빈 시트 제외)", async () => {
    const chunks = await extractChunks(fx("sample.xlsx"), "xlsx");
    const cost = chunks.find((c) => c.section_title === "인증 비용")!;
    expect(cost.content).toContain("인증 종류: 비건 | 항목: 심사비 | 금액: 3000000 | 비고: 제품 수에 따라 변동");
    expect(cost.content).toContain("인증 종류: EPD | 항목: 검증비 | 금액: 5000000"); // 빈 셀은 생략
    expect(cost.content).not.toContain("비고: null");
    const sched = chunks.find((c) => c.section_title === "심사 일정")!;
    expect(sched.content).toContain("단계: 서류 검토 | 소요 기간: 2주");
    expect(chunks.some((c) => c.section_title === "빈 시트")).toBe(false);
    expect(chunks.every((c) => c.page_no === null)).toBe(true);
  });
  it("CSV(UTF-8 BOM)", async () => {
    const csv = new TextEncoder().encode("﻿인증,금액\n비건,3000000\n유기농,2500000\n");
    const chunks = await extractChunks(csv, "csv");
    expect(chunks[0].content).toContain("인증: 비건 | 금액: 3000000");
    expect(chunks[0].content).toContain("인증: 유기농 | 금액: 2500000");
    expect(chunks[0].section_title).toBeNull();
  });
  it("내용 없는 CSV", async () => {
    await expect(extractChunks(new TextEncoder().encode("\n\n"), "csv")).rejects.toMatchObject({ code: "empty", message: EXTRACT_MESSAGES.empty });
  });
});

describe("PPTX", () => {
  it("슬라이드 번호가 page_no, 제목이 section_title, 표는 통째로 — 슬라이드 순서는 presentation.xml 기준", async () => {
    const pptx = buildPptx(
      [
        { title: "두 번째로 나오는 슬라이드", paras: ["파일 번호는 1번입니다."] },
        { title: "첫 슬라이드: 인증 절차", paras: ["신청 → 검토 → 심사"], table: [["단계", "기간"], ["검토", "2주"]] },
      ],
      [2, 1],
    );
    const chunks = await extractChunks(new Uint8Array(pptx), "pptx");
    expect(chunks.map((c) => c.page_no)).toEqual([1, 2]);
    expect(chunks[0].section_title).toBe("첫 슬라이드: 인증 절차");
    expect(chunks[0].content).toContain("단계 | 기간");
    expect(chunks[0].content).toContain("검토 | 2주");
    expect(chunks[1].section_title).toBe("두 번째로 나오는 슬라이드");
  });
});

describe("TXT / MD", () => {
  it("txt 는 그대로(CP949 도 정상)", async () => {
    for (const f of ["sample-utf8.txt", "sample-cp949.txt"]) {
      const chunks = await extractChunks(fx(f), "txt");
      expect(chunks.map((c) => c.content).join("\n")).toContain("2. 서류 검토\n부족한 자료는 보완을 요청합니다.");
    }
  });
  it("md 는 제목→section_title, 표는 통째로", async () => {
    const md = "# 인증 안내\n\n소개 문단입니다.\n\n## 비용\n\n| 인증 | 금액 |\n|---|---|\n| 비건 | 300만원 |\n| 유기농 | 250만원 |\n\n끝.";
    const chunks = await extractChunks(new TextEncoder().encode(md), "md");
    const cost = chunks.find((c) => c.section_title === "비용")!;
    expect(cost.content).toContain("인증 | 금액");
    expect(cost.content).toContain("비건 | 300만원");
    expect(cost.content).toContain("유기농 | 250만원");
    expect(cost.content).not.toContain("---");
  });
  it("빈 txt", async () => {
    await expect(extractChunks(new TextEncoder().encode("  \n\n "), "txt")).rejects.toBeInstanceOf(ExtractError);
  });
});
