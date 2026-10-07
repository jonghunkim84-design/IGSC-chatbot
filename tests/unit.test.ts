/** API 호출 없는 순수 로직 단위 테스트. 실행: npm run test:unit */
import { describe, expect, it } from "vitest";
import { decideAccess } from "@/lib/admin/access";
import { isAllowedEmail, parseAllowedEmails } from "@/lib/admin/allowlist";
import { kstDayStartISO, kstTodayYmd, kstWeekStartYmd } from "@/lib/admin/labels";
import { CERT_NAMES, certName, hasCertName, listCertNames } from "@/lib/cert-names";
import { parseClassification } from "@/lib/chat/classify";
import { isForeignLanguage } from "@/lib/chat/run-chat";
import { validateFaqInput, type FaqInput } from "@/lib/db/admin-faq";
import { summarize } from "@/lib/db/admin-stats";
import { parseSelection } from "@/lib/search/select-faq";

describe("관리자 접근 제어", () => {
  const raw = " Admin@Example.com , second@example.com ,, ";
  it("허용 목록 파싱·판정", () => {
    expect(parseAllowedEmails(raw)).toEqual(["admin@example.com", "second@example.com"]);
    expect(isAllowedEmail("ADMIN@example.com", raw)).toBe(true);
    expect(isAllowedEmail("other@example.com", raw)).toBe(false);
    expect(isAllowedEmail("admin@example.com", "")).toBe(false);
    expect(isAllowedEmail(null, raw)).toBe(false);
  });
  it("미들웨어 판정", () => {
    expect(decideAccess("/admin", null, raw)).toBe("login");
    expect(decideAccess("/admin/faq", "other@example.com", raw)).toBe("forbidden");
    expect(decideAccess("/admin/faq", "admin@example.com", raw)).toBe("allow");
    expect(decideAccess("/admin/login", null, raw)).toBe("allow");
    expect(decideAccess("/admin/auth/callback", null, raw)).toBe("allow");
    expect(decideAccess("/api/admin/login", null, raw)).toBe("allow");
    expect(decideAccess("/admin/loginx", null, raw)).toBe("login");
    expect(decideAccess("/api/admin/other", null, raw)).toBe("login");
  });
});

describe("KST 날짜 계산", () => {
  it("이번 주 시작은 월요일", () => {
    // 2026-09-30 은 수요일 → 월요일 2026-09-28
    const wed = new Date("2026-09-30T03:00:00Z");
    expect(kstTodayYmd(wed)).toBe("2026-09-30");
    expect(kstWeekStartYmd(wed)).toBe("2026-09-28");
    // 일요일 → 그 주 월요일
    expect(kstWeekStartYmd(new Date("2026-10-04T01:00:00Z"))).toBe("2026-09-28");
    // 월요일 당일
    expect(kstWeekStartYmd(new Date("2026-10-05T00:30:00Z"))).toBe("2026-10-05");
  });
  it("UTC 자정 직전 시각도 KST 로는 다음 날", () => {
    expect(kstTodayYmd(new Date("2026-09-29T15:30:00Z"))).toBe("2026-09-30");
    expect(kstDayStartISO("2026-09-30")).toBe("2026-09-29T15:00:00.000Z");
  });
});

describe("대시보드 집계", () => {
  it("답변 성공률 = answered ÷ (answered + handoff)", () => {
    const s = summarize(["answered", "answered", "handoff", "clarify", "consulting_blocked", "out_of_scope"]);
    expect(s.total).toBe(6);
    expect(s.successRate).toBeCloseTo(2 / 3);
    expect(summarize(["clarify"]).successRate).toBeNull();
    expect(summarize([]).total).toBe(0);
  });
});

describe("FAQ 저장 검증", () => {
  const base: FaqInput = { question: "질문", variants: [], answer: "답", cert_type: "vegan", category: "scope", source_url: null, status: "draft", needs_input: false };
  it("정상/거부 규칙", () => {
    expect(validateFaqInput(base)).toBeNull();
    expect(validateFaqInput({ ...base, question: " " })).not.toBeNull();
    expect(validateFaqInput({ ...base, cert_type: "" })).not.toBeNull();
    expect(validateFaqInput({ ...base, source_url: "javascript:alert(1)" })).not.toBeNull();
    expect(validateFaqInput({ ...base, status: "approved", needs_input: true })).not.toBeNull();
    expect(validateFaqInput({ ...base, status: "approved", answer: "" })).not.toBeNull();
    expect(validateFaqInput({ ...base, status: "approved", source_url: "https://igsc.kr/x" })).toBeNull();
  });
});

describe("챗봇 보조 로직", () => {
  it("외국어 문의 판정", () => {
    expect(isForeignLanguage("How much does vegan certification cost?")).toBe(true);
    expect(isForeignLanguage("EPD 비용")).toBe(false);
    expect(isForeignLanguage("EPD?")).toBe(false);
  });
  it("분류 응답 파싱", () => {
    expect(parseClassification('{"label":"consulting","eligibility":false,"cert_specified":true}')).toEqual({ label: "consulting", eligibility: false, certSpecified: true });
    expect(parseClassification('{"label":"allowed"}').certSpecified).toBe(true); // 누락 시 되묻기로 빠지지 않음
    expect(() => parseClassification('{"label":"nope"}')).toThrow();
    expect(() => parseClassification("모르겠습니다")).toThrow();
  });
  it("FAQ 선택 응답 파싱: 범위 밖 번호·중복 제거, 최대 SELECT_MAX(5)개", () => {
    expect(parseSelection("[2, 2, 9, 1]", 3)).toEqual([2, 1]);
    expect(parseSelection("[1,2,3,4,5,6,7]", 10)).toEqual([1, 2, 3, 4, 5]);
    expect(parseSelection("[]", 5)).toEqual([]);
    expect(() => parseSelection("없음", 5)).toThrow();
  });
  it("FAQ 선택 응답이 중간에 잘려도(닫는 대괄호 없음) 읽을 수 있는 앞쪽 번호만 쓴다", () => {
    expect(parseSelection("[2, 3, 10, 13, 14, 20, 24, 31, 39, 47, 50, 53, 58, 59, 62, 64, 67", 100)).toEqual([2, 3, 10, 13, 14]);
    expect(parseSelection("[4, 7, 1", 100)).toEqual([4, 7]); // 마지막 '1'은 끊겼을 수 있어 버린다
    expect(() => parseSelection("번호 없음", 5)).toThrow();
  });
});

describe("cert-names 매핑", () => {
  it("한글명 매핑과 미등록 slug 처리", () => {
    expect(certName("vegan")).toBe("비건(Vegan)");
    expect(certName("common")).toBe("공통");
    expect(hasCertName("no-such-cert")).toBe(false);
    expect(certName("no-such-cert")).toBe("no-such-cert");
    expect(listCertNames().some((c) => c.slug === "common")).toBe(false);
    expect(Object.keys(CERT_NAMES).length).toBeGreaterThan(40);
  });
});

import {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  MSG_HWP_REJECTED,
  checkFile,
  isValidStoragePath,
  normalizeFileName,
  storagePathFor,
} from "@/lib/admin/documents";

describe("문서 업로드 규칙", () => {
  it("허용 형식 7가지는 통과", () => {
    for (const ext of ["pdf", "docx", "xlsx", "csv", "txt", "md", "pptx"]) {
      const r = checkFile(`문서.${ext}`, 1000);
      expect(r.ok, ext).toBe(true);
      if (r.ok) expect(r.contentType).toBe(ALLOWED_TYPES[ext]);
    }
    expect(checkFile("REPORT.PDF", 1000).ok).toBe(true); // 대소문자 무관
  });
  it("hwp/hwpx 는 PDF 안내와 함께 거부", () => {
    for (const n of ["신청서.hwp", "신청서.HWPX"]) {
      const r = checkFile(n, 1000);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("hwp");
        expect(r.message).toBe(MSG_HWP_REJECTED);
        expect(r.message).toContain("PDF");
      }
    }
  });
  it("그 밖의 형식·빈 파일·20MB 초과 거부", () => {
    expect(checkFile("setup.exe", 1000).ok).toBe(false);
    expect(checkFile("noext", 1000).ok).toBe(false);
    expect(checkFile("a.pdf", 0).ok).toBe(false);
    expect(checkFile("a.pdf", MAX_FILE_BYTES).ok).toBe(true);
    const big = checkFile("a.pdf", MAX_FILE_BYTES + 1);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.code).toBe("size");
  });
  it("한글·공백 파일명 유지, macOS 분리형 자모는 합침, 경로·제어문자 제거", () => {
    expect(normalizeFileName("인증 절차서 (개정) 최종본.pdf")).toBe("인증 절차서 (개정) 최종본.pdf");
    const nfd = "한글 문서.pdf".normalize("NFD");
    expect(nfd).not.toBe("한글 문서.pdf");
    expect(normalizeFileName(nfd)).toBe("한글 문서.pdf");
    expect(normalizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(normalizeFileName(["C:", "Users", "a", "b.docx"].join(String.fromCharCode(92)))).toBe("b.docx");
    expect(normalizeFileName("a\u0000b.pdf")).toBe("ab.pdf");
    expect(normalizeFileName("가".repeat(300) + ".pdf").length).toBeLessThanOrEqual(200);
    expect(normalizeFileName("가".repeat(300) + ".pdf").endsWith(".pdf")).toBe(true);
  });
  it("저장 경로는 uuid 기반이고 파일명과 무관", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const p = storagePathFor(id, "pdf");
    expect(p).toBe(`${id}.pdf`);
    expect(isValidStoragePath(p)).toBe(true);
    for (const bad of ["../x.pdf", "한글.pdf", `${id}.exe`, `${id}.hwp`, `folder/${id}.pdf`, `${id}`]) {
      expect(isValidStoragePath(bad), bad).toBe(false);
    }
  });
});
