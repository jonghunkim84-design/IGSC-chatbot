/**
 * Phase 10: 문서 기반 초안의 안전판(코드 검증) 테스트. API·DB 호출 없음 — 모델 응답은 테스트가 직접 만든다.
 * "모델이 지어낸 초안"을 일부러 만들어 전부 폐기되고 로그가 남는지 확인한다.
 */
import { describe, expect, it, vi } from "vitest";
import { CONTEXT_BUDGET_CHARS, draftFromDocs, fitToBudget, prioritizeDocs, verifyDraft } from "@/lib/docs/draft";
import type { DocChunk, DocInfo, DraftDeps, DraftLog, LabeledChunk, RawDraft } from "@/lib/docs/draft";
import { norm, numberTokens, sentenceSupport, validateEvidence } from "@/lib/ingest/evidence";

const DOC_A: DocInfo = { id: "doc-a", file_name: "비건 인증 심사 안내.pdf", cert_type: "vegan", doc_category: "procedure", sections: [] };
const DOC_B: DocInfo = { id: "doc-b", file_name: "EPD 검증 안내.docx", cert_type: "epd", doc_category: "fee", sections: [] };

const CHUNKS: DocChunk[] = [
  { id: "k1", document_id: "doc-a", chunk_index: 0, page_no: 3, section_title: "심사 절차", content: "비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다. 심사비는 제품 수에 따라 달라지며 담당자 검토 후 확정됩니다." },
  { id: "k2", document_id: "doc-a", chunk_index: 1, page_no: 4, section_title: "제출 서류", content: "제출 서류는 신청서와 제품 원료 목록입니다." },
  { id: "k3", document_id: "doc-b", chunk_index: 0, page_no: null, section_title: null, content: "EPD 검증은 별도 절차로 진행됩니다. 검증비는 3,000,000원입니다." },
];

const labeled = (): LabeledChunk[] =>
  CHUNKS.map((c, i) => ({ ...c, label: `C${i + 1}`, file_name: c.document_id === "doc-a" ? DOC_A.file_name : DOC_B.file_name }));

const good: RawDraft = {
  found: true,
  category: "duration",
  confidence: "high",
  answer: "비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다.",
  evidence: [{ chunk: "C1", quote: "비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다." }],
};

function makeDeps(raw: RawDraft | (() => RawDraft), opts: { docs?: DocInfo[]; select?: (q: string, d: DocInfo[]) => string[] } = {}) {
  const warn = vi.fn();
  const info = vi.fn();
  const log: DraftLog = { warn, info };
  const selectDocs = vi.fn(async (q: string, d: DocInfo[]) => (opts.select ? opts.select(q, d) : d.map((x) => x.id)));
  const generate = vi.fn(async () => (typeof raw === "function" ? raw() : raw));
  const deps: DraftDeps = {
    loadDocs: async () => opts.docs ?? [DOC_A, DOC_B],
    loadChunks: async (ids) => CHUNKS.filter((c) => ids.includes(c.document_id)),
    selectDocs,
    generate,
    log,
  };
  return { deps, warn, info, selectDocs, generate };
}

describe("정상 초안", () => {
  it("검증을 통과하면 답변·근거·출처(파일·페이지)를 돌려준다", async () => {
    const { deps, warn } = makeDeps(good);
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("drafted");
    if (out.status !== "drafted") return;
    expect(out.draft.answer).toContain("서류 검토 2주");
    expect(out.draft.evidence).toEqual(["비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다."]);
    expect(out.draft.sources).toEqual([{ document_id: "doc-a", file_name: "비건 인증 심사 안내.pdf", page_no: 3 }]);
    expect(out.primary.page_no).toBe(3);
    expect(out.docCertType).toBe("vegan");
    expect(out.draft.confidence).toBe("high");
    expect(warn).not.toHaveBeenCalled();
  });
  it("표현을 바꾼 문장(같은 사실)은 통과하고, 목록 번호는 숫자 검사에서 제외한다", () => {
    const raw: RawDraft = { ...good, answer: "1. 서류 검토에는 2주가 걸립니다.\n2. 현장 심사에는 1주가 걸립니다.", evidence: [{ chunk: "C1", quote: "서류 검토 2주, 현장 심사 1주 순서로 진행됩니다" }] };
    const v = verifyDraft(raw, labeled());
    expect(v.ok, v.ok ? "" : v.reason).toBe(true);
  });
  it("여러 조각을 인용하면 출처가 문서·페이지별로 모인다", () => {
    const raw: RawDraft = {
      ...good,
      answer: "비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행되며, 제출 서류는 신청서와 제품 원료 목록입니다.",
      evidence: [{ chunk: "C1", quote: "서류 검토 2주, 현장 심사 1주 순서로 진행됩니다" }, { chunk: "C2", quote: "제출 서류는 신청서와 제품 원료 목록입니다" }],
    };
    const v = verifyDraft(raw, labeled());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.sources.map((s) => s.page_no)).toEqual([3, 4]);
  });
});

describe("근거가 없을 때", () => {
  it("모델이 found=false 를 내면 답을 만들지 않는다 (not_found)", async () => {
    const { deps, info, warn } = makeDeps({ found: false, answer: "", category: "cost", confidence: "low", evidence: [] });
    const out = await draftFromDocs("비건 인증 비용은 얼마인가요?", undefined, deps);
    expect(out).toMatchObject({ status: "not_found", category: "cost" });
    expect(info).toHaveBeenCalledWith("근거를 찾지 못함", expect.anything());
    expect(warn).not.toHaveBeenCalled();
  });
  it("found=true 인데 답변이 비어 있으면 not_found", async () => {
    const { deps } = makeDeps({ ...good, answer: "  " });
    expect((await draftFromDocs("q", undefined, deps)).status).toBe("not_found");
  });
  it("추출된 문서가 없으면 no_docs (모델을 호출하지 않는다)", async () => {
    const { deps, generate } = makeDeps(good, { docs: [] });
    expect((await draftFromDocs("q", undefined, deps)).status).toBe("no_docs");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("환각 방지: 검증에 걸리면 초안을 버린다 (rejected + 경고 로그)", () => {
  const cases: [string, RawDraft, RegExp][] = [
    ["원문에 없는 숫자 (500만원)", { ...good, answer: "비건 인증 심사비는 500만원입니다.", evidence: [{ chunk: "C3", quote: "검증비는 3,000,000원입니다" }] }, /숫자 "500"/],
    ["단위를 바꾼 숫자 (3,000,000원 → 300만원)", { ...good, category: "cost", answer: "EPD 검증비는 300만원입니다.", evidence: [{ chunk: "C3", quote: "검증비는 3,000,000원입니다" }] }, /숫자 "300"/],
    ["같은 조각의 다른 부분에서 가져온 숫자를 근거 문장 없이 사용", { ...good, answer: "서류 검토 2주, 현장 심사 3주 순서로 진행됩니다.", evidence: [{ chunk: "C1", quote: "비건 인증 심사는 서류 검토 2주" }] }, /숫자 "3"/],
    ["인용문이 원문과 한 글자 다름", { ...good, evidence: [{ chunk: "C1", quote: "비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다!" }] }, /원문에 없음/],
    ["인용문을 다른 chunk 로 잘못 표기(다른 조각의 문장 도용)", { ...good, evidence: [{ chunk: "C2", quote: "서류 검토 2주, 현장 심사 1주 순서로 진행됩니다" }] }, /C2 원문에 없음/],
    ["존재하지 않는 chunk 인용", { ...good, evidence: [{ chunk: "C9", quote: "서류 검토 2주, 현장 심사 1주 순서로" }] }, /존재하지 않는 chunk/],
    ["근거(evidence) 없음", { ...good, evidence: [] }, /evidence 없음/],
    ["근거 문장이 너무 짧음", { ...good, evidence: [{ chunk: "C1", quote: "2주" }] }, /너무 짧음/],
    [
      "근거 없는 문장을 덧붙임",
      { ...good, answer: `${good.answer} 인증서는 심사 종료 직후 즉시 발급되며 별도의 수수료는 전혀 부과되지 않습니다.` },
      /근거가 부족한 문장/,
    ],
    [
      "전혀 다른 내용을 사실처럼 작성 (진짜 인용문만 붙임)",
      { ...good, answer: "비건 인증은 해외 인증기관의 승인을 받아야 하며 정기 점검이 필수입니다.", evidence: [{ chunk: "C2", quote: "제출 서류는 신청서와 제품 원료 목록입니다" }] },
      /근거가 부족한 문장/,
    ],
  ];
  for (const [name, raw, reason] of cases) {
    it(`폐기: ${name}`, async () => {
      const { deps, warn } = makeDeps(raw);
      const out = await draftFromDocs("질문", undefined, deps);
      expect(out.status).toBe("rejected");
      if (out.status === "rejected") expect(out.reason).toMatch(reason);
      // 폐기 사실이 로그로 남는다 (사유 포함)
      expect(warn.mock.calls.filter((c) => c[0] === "초안 폐기(근거 검증 실패)")).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith("초안 폐기(근거 검증 실패)", expect.objectContaining({ reason: expect.stringMatching(reason) }));
    });
  }
});

describe("후보 문서 좁히기", () => {
  const many = (n: number): DocInfo[] => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, file_name: `문서${i}.pdf`, cert_type: i % 2 ? "vegan" : "epd", doc_category: "other", sections: [] }));

  it("문서가 1~2개여도 항상 문서 고르기를 호출하고, 고른 문서만 쓴다", async () => {
    const { deps, selectDocs } = makeDeps(good, { docs: [DOC_A, DOC_B], select: () => ["doc-a"] });
    const loaded: string[][] = [];
    deps.loadChunks = async (ids) => (loaded.push(ids), CHUNKS.filter((c) => ids.includes(c.document_id)));
    await draftFromDocs("q", undefined, deps);
    expect(selectDocs).toHaveBeenCalledTimes(1);
    expect(loaded[0]).toEqual(["doc-a"]);
  });
  it("문서가 1개뿐이어도 관련 없다고 판단하면 not_found (그 문서에서 억지로 답을 만들지 않는다)", async () => {
    const { deps, generate } = makeDeps(good, { docs: [DOC_A], select: () => [] });
    const out = await draftFromDocs("q", undefined, deps);
    expect(out.status).toBe("not_found");
    expect(generate).not.toHaveBeenCalled();
  });
  it("문서가 4개 이상이면 고른 문서만(최대 3개) 사용한다", async () => {
    const docs = [DOC_A, ...many(5)];
    const { deps, selectDocs } = makeDeps(good, { docs, select: () => ["doc-a", "d1", "d2", "d3", "d4"] });
    const loaded: string[][] = [];
    deps.loadChunks = async (ids) => (loaded.push(ids), CHUNKS.filter((c) => ids.includes(c.document_id)));
    await draftFromDocs("q", undefined, deps);
    expect(selectDocs).toHaveBeenCalledTimes(1);
    expect(loaded[0]).toEqual(["doc-a", "d1", "d2"]);
  });
  it("고른 문서가 없으면 not_found (초안 생성 호출 없음)", async () => {
    const { deps, generate } = makeDeps(good, { docs: [DOC_A, ...many(4)], select: () => [] });
    expect((await draftFromDocs("q", undefined, deps)).status).toBe("not_found");
    expect(generate).not.toHaveBeenCalled();
  });
  it("인증 종류가 있으면 해당 인증 + 공통 문서를 우선, 없으면 전체", () => {
    const docs: DocInfo[] = [DOC_A, DOC_B, { ...DOC_A, id: "c", cert_type: "common" }];
    expect(prioritizeDocs(docs, "vegan").map((d) => d.id)).toEqual(["doc-a", "c"]);
    expect(prioritizeDocs(docs, "organic").map((d) => d.id)).toEqual(["c"]); // 해당 인증 문서가 없어도 공통 문서가 있으면 공통만
    expect(prioritizeDocs([DOC_A, DOC_B], "organic").map((d) => d.id)).toEqual(["doc-a", "doc-b"]); // 공통도 없으면 전체로 대체
    expect(prioritizeDocs(docs).map((d) => d.id)).toEqual(["doc-a", "doc-b", "c"]);
  });
  it("컨텍스트 예산을 넘으면 질문과 관련 있는 조각을 우선 남긴다", () => {
    const filler = (i: number): DocChunk => ({ id: `f${i}`, document_id: "x", chunk_index: i, page_no: null, section_title: null, content: "무관한 내용입니다. ".repeat(100) });
    const target: DocChunk = { id: "t", document_id: "x", chunk_index: 999, page_no: null, section_title: null, content: "비건 인증 심사비 안내: 담당자가 확정합니다." };
    const kept = fitToBudget("비건 인증 심사비는 얼마인가요", [...Array.from({ length: 200 }, (_, i) => filler(i)), target], 5000);
    expect(kept.some((c) => c.id === "t")).toBe(true);
    expect(kept.reduce((n, c) => n + c.content.length, 0)).toBeLessThanOrEqual(5000);
    expect(fitToBudget("q", [target])).toEqual([target]); // 예산 이내면 그대로
    expect(CONTEXT_BUDGET_CHARS).toBeGreaterThan(50_000);
  });
});

describe("공용 evidence 검증 (Phase 2 + Phase 10)", () => {
  const src = "심사비는 3,000,000원이며 기간은 2주입니다.";
  it("Phase 2 기본 모드: 증거·숫자가 원문에 있으면 통과, 없으면 사유 반환", () => {
    expect(validateEvidence({ answer: "심사비는 3,000,000원입니다.", evidence: ["심사비는 3,000,000원이며"] }, src)).toBeNull();
    expect(validateEvidence({ answer: "", evidence: ["x"] }, src)).toBe("빈 답변");
    expect(validateEvidence({ answer: "a", evidence: [] }, src)).toBe("evidence 없음");
    expect(validateEvidence({ answer: "a", evidence: ["없는 문장"] }, src)).toMatch(/evidence가 원문에 없음/);
    expect(validateEvidence({ answer: "기간은 9주입니다.", evidence: ["기간은 2주입니다"] }, src)).toMatch(/숫자 "9"/);
  });
  it("엄격 모드: 숫자 토큰이 정확히 같아야 한다", () => {
    const item = { answer: "심사비는 3,000,000원입니다.", evidence: ["심사비는 3,000,000원이며"] };
    expect(validateEvidence(item, src, { strictNumbers: true })).toBeNull();
    expect(validateEvidence({ ...item, answer: "심사비는 300만원입니다." }, src, { strictNumbers: true })).toMatch(/숫자 "300"/);
    expect(validateEvidence({ ...item, answer: "심사비는 3000000원입니다." }, src, { strictNumbers: true })).toBeNull(); // 쉼표 표기 차이만 허용
  });
  it("보조 함수", () => {
    expect(numberTokens("3,000,000원, 12.5%, 2주")).toEqual(["3000000", "12.5", "2"]);
    expect(norm("가 나\n다")).toBe("가나다");
    expect(sentenceSupport("서류 검토에는 2주가 걸립니다", "서류 검토 2주, 현장 심사 1주")).toBeGreaterThan(0.45);
    expect(sentenceSupport("해외 기관의 승인이 필요합니다", "제출 서류는 신청서입니다")).toBeLessThan(0.45);
  });
});

import { missingSubjects, questionSubjects, stripSourceMentions } from "@/lib/docs/draft";

describe("질문 대상 확인 (엉뚱한 일반 문서로 답을 만들지 않는다)", () => {
  it("'○○ 인증/검증/심사' 형태의 대상 이름을 뽑는다 (지시어·일반어 제외)", () => {
    expect(questionSubjects("할랄 인증 신청 절차와 필요한 서류를 알려 주세요.")).toEqual(["할랄"]);
    expect(questionSubjects("EPD 인증 심사 비용은 얼마인가요?")).toEqual(["EPD"]);
    expect(questionSubjects("ISO 9001 인증은 어떻게 받나요?")).toEqual(["9001"]);
    expect(questionSubjects("비건 인증과 유기농 인증의 차이는?").sort()).toEqual(["비건", "유기농"]);
    expect(questionSubjects("이 인증은 얼마나 걸리나요? 해당 인증 절차는?")).toEqual([]);
    expect(questionSubjects("인증서는 언제 발급되나요?")).toEqual([]);
    expect(questionSubjects("서류 검토와 현장 심사는 각각 얼마나 걸리나요?")).toEqual(["현장"]); // '현장 심사' 도 이름으로 뽑히지만 문서에 있으면 통과
  });
  it("대상 이름이 문서에 없으면 missing 으로 돌려준다 (공백·대소문자 무시)", () => {
    const corpus = "비건 인증 심사 안내\nEPD 검증은 별도 절차입니다. 현장 심사는 1주.";
    expect(missingSubjects(["할랄"], corpus)).toEqual(["할랄"]);
    expect(missingSubjects(["비건", "epd", "현장"], corpus)).toEqual([]);
  });
  it("문서가 답할 수 없는 대상(할랄)을 지목한 질문은 모델을 부르지 않고 not_found", async () => {
    const { deps, generate, info } = makeDeps(good);
    const out = await draftFromDocs("할랄 인증 신청 절차와 필요한 서류를 알려 주세요.", undefined, deps);
    expect(out.status).toBe("not_found");
    if (out.status === "not_found") expect(out.reason).toContain("할랄");
    expect(generate).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("질문의 대상이 문서에 없음", expect.objectContaining({ absent: ["할랄"] }));
  });
  it("문서에 있는 대상(비건)을 지목한 질문은 그대로 진행", async () => {
    const { deps, generate } = makeDeps(good);
    const out = await draftFromDocs("비건 인증 심사 기간은 얼마나 걸리나요?", undefined, deps);
    expect(out.status).toBe("drafted");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("출처 언급 문장 제거", () => {
  it("'~문서에 따른 내용입니다' 같은 형식 문장은 지우고 사실 문장만 남긴다", () => {
    const r = stripSourceMentions("제출 서류는 신청서와 제품 원료 목록입니다. 이는 비건 인증 심사 안내 문서에 따른 내용입니다.");
    expect(r.text).toBe("제출 서류는 신청서와 제품 원료 목록입니다.");
    expect(r.removed).toHaveLength(1);
    expect(stripSourceMentions("서류는 신청서입니다.").removed).toEqual([]);
  });
  it("출처 문장이 붙어도 나머지가 근거와 일치하면 초안이 통과한다", () => {
    const raw: RawDraft = { found: true, category: "document", confidence: "high", answer: "제출 서류는 신청서와 제품 원료 목록입니다. 이는 비건 인증 심사 안내 문서에 따른 내용입니다.", evidence: [{ chunk: "C2", quote: "제출 서류는 신청서와 제품 원료 목록입니다" }] };
    const v = verifyDraft(raw, labeled());
    expect(v.ok, v.ok ? "" : v.reason).toBe(true);
    if (v.ok) expect(v.draft.answer).toBe("제출 서류는 신청서와 제품 원료 목록입니다.");
  });
  it("출처 문장만 있는 답변은 내용이 없으므로 폐기된다", () => {
    const raw: RawDraft = { found: true, category: "document", confidence: "high", answer: "이는 비건 인증 심사 안내 문서에 따른 내용입니다.", evidence: [{ chunk: "C2", quote: "제출 서류는 신청서와 제품 원료 목록입니다" }] };
    expect(verifyDraft(raw, labeled()).ok).toBe(false);
  });
});

describe("근거 부족 문장 때문에 탈락하면 1회만 다시 쓰게 한다", () => {
  const withFraming: RawDraft = { ...good, answer: "이 과정은 인증의 신뢰성을 높이는 핵심 장치입니다. 비건 인증 심사는 서류 검토 2주, 현장 심사 1주 순서로 진행됩니다." };

  it("첫 답변에 근거 없는 도입 문장이 있고, 다시 쓴 답변이 검증을 통과하면 그 답변을 쓴다", async () => {
    const { deps, generate, warn } = makeDeps(withFraming);
    generate.mockResolvedValueOnce(withFraming).mockResolvedValueOnce(good);
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("drafted");
    if (out.status !== "drafted") return;
    expect(out.draft.answer).not.toContain("핵심 장치");
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls as unknown[][])[1][2]).toEqual([expect.stringContaining("핵심 장치")]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("재작성"), expect.anything());
  });
  it("다시 써도 근거가 부족하면 폐기한다 (재시도는 1번뿐)", async () => {
    const { deps, generate } = makeDeps(withFraming);
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("rejected");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("숫자를 바꾼 초안은 재시도 없이 바로 폐기한다 (근거 문장 자체의 문제)", async () => {
    const { deps, generate } = makeDeps({ ...good, answer: "비건 인증 심사는 서류 검토 3주, 현장 심사 1주 순서로 진행됩니다." });
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("rejected");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("다시 쓴 결과가 '근거 없음'이면 초안을 만들지 않고 폐기 상태로 남긴다", async () => {
    const { deps, generate } = makeDeps(withFraming);
    generate.mockResolvedValueOnce(withFraming).mockResolvedValueOnce({ found: false, answer: "", category: "scope", confidence: "low", evidence: [] });
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("rejected");
  });
});

describe("evidence 를 빠뜨린 답변도 1회만 다시 쓰게 한다", () => {
  it("첫 시도에 evidence 가 비어 있고 두 번째에 제대로 제출하면 초안을 만든다", async () => {
    const { deps, generate } = makeDeps({ ...good, evidence: [] });
    generate.mockResolvedValueOnce({ ...good, evidence: [] }).mockResolvedValueOnce(good);
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("drafted");
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls as unknown[][])[1][2]).toEqual([expect.stringContaining("서류 검토")]);
  });
  it("두 번 다 evidence 가 없으면 폐기한다", async () => {
    const { deps, generate } = makeDeps({ ...good, evidence: [] });
    const out = await draftFromDocs("비건 인증 심사 기간은?", undefined, deps);
    expect(out.status).toBe("rejected");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe("너무 짧은 인용은 버리고, 쓸 만한 인용이 남으면 계속 검증한다", () => {
  it("짧은 인용(번호 등)이 섞여 있어도 나머지 인용이 답변을 뒷받침하면 통과한다", () => {
    const v = verifyDraft({ ...good, evidence: [{ chunk: "C1", quote: "2주" }, ...good.evidence] }, labeled());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.evidence).toEqual(good.evidence.map((e) => e.quote));
  });
  it("짧은 인용을 버렸더니 답변의 숫자를 뒷받침하는 인용이 없으면 폐기한다", () => {
    const v = verifyDraft({ ...good, answer: "서류 검토 2주, 현장 심사 1주 순서로 진행됩니다. 심사비는 500만원입니다.", evidence: [{ chunk: "C1", quote: "500" }, ...good.evidence] }, labeled());
    expect(v.ok).toBe(false);
  });
});
