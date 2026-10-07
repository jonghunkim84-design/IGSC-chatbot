/** Phase 11: 검수 화면의 근거 문장 강조 (원문 그대로를 유지하며 강조 구간만 나눈다). */
import { describe, expect, it } from "vitest";
import { findEvidenceRanges, highlightSegments } from "@/lib/docs/highlight";

const TEXT = "1. 심사 절차\n서류 검토에는 2주가 소요되며,\n현장 심사에는 1주가 소요됩니다. 제출 서류는 신청서입니다.";

describe("highlightSegments", () => {
  it("근거 문장을 강조하고, 이어 붙이면 원문과 정확히 같다", () => {
    const segs = highlightSegments(TEXT, ["서류 검토에는 2주가 소요되며"]);
    expect(segs.map((s) => s.text).join("")).toBe(TEXT);
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(["서류 검토에는 2주가 소요되며"]);
  });

  it("줄바꿈·공백이 달라도 찾아서 원문 그대로 강조한다", () => {
    const segs = highlightSegments(TEXT, ["소요되며, 현장 심사에는 1주가 소요됩니다"]);
    expect(segs.map((s) => s.text).join("")).toBe(TEXT);
    expect(segs.some((s) => s.mark && s.text.includes("현장 심사에는 1주"))).toBe(true);
  });

  it("원문에 없는 문장은 강조하지 않는다", () => {
    const segs = highlightSegments(TEXT, ["심사비는 500만원입니다"]);
    expect(segs.some((s) => s.mark)).toBe(false);
    expect(findEvidenceRanges(TEXT, ["심사비는 500만원입니다"])).toEqual([]);
  });

  it("근거가 없으면 통째로 하나의 구간", () => {
    expect(highlightSegments(TEXT, [])).toEqual([{ text: TEXT, mark: false }]);
  });
});
