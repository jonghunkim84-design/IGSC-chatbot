/**
 * Phase 14-1 인증 종류 관리: 초기 데이터 이관 완전성, DB 값 반영(applyCertTypes), 비활성화, 입력 검증.
 * 이 파일의 첫 테스트는 applyCertTypes 를 부르기 전의 기본값(CERT_NAMES)을 본다 (vitest 는 파일마다 모듈이 분리된다).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CERT_NAMES, applyCertTypes, certName, hasCertName, isCertActive, listCertNames, type CertTypeRow } from "@/lib/cert-names";
import { validateCertType } from "@/lib/db/cert-types";

const row = (code: string, over: Partial<CertTypeRow> = {}): CertTypeRow => ({ code, name_ko: `${code} 이름`, name_en: null, category: "기타", is_active: true, sort_order: 0, ...over });

describe("초기 데이터 이관 (마이그레이션 0009)", () => {
  const sql = readFileSync("supabase/migrations/0009_cert_types.sql", "utf8");
  const insertBlock = sql.slice(sql.indexOf("insert into public.cert_types"), sql.indexOf("on conflict"));
  const migrated = [...insertBlock.matchAll(/^\s*\('([a-z0-9-]+)', '((?:[^']|'')*)',/gm)].map((m) => [m[1], m[2].replace(/''/g, "'")] as const);

  it("기존 CERT_NAMES 의 모든 코드가 누락 없이, 이름 그대로 들어 있다", () => {
    const seed = Object.entries(CERT_NAMES);
    expect(migrated.length).toBe(seed.length);
    const byCode = new Map(migrated);
    for (const [code, name] of seed) expect(byCode.get(code), code).toBe(name);
  });

  it("추가로 끼어든 코드가 없다", () => {
    for (const [code] of migrated) expect(hasCertName(code), code).toBe(true);
  });

  it("분류는 허용된 5가지 값이다", () => {
    const cats = [...insertBlock.matchAll(/, '(식품|화장품|지속가능성|검증|기타)', (?:true|false), \d+\)/g)].length;
    expect(cats).toBe(migrated.length);
  });
});

describe("applyCertTypes (DB 값 반영)", () => {
  it("DB 가 비어 있으면(테이블 없음) 기본값을 유지한다", () => {
    applyCertTypes([]);
    expect(certName("vegan")).toBe("비건(Vegan)");
  });

  it("새 인증 종류를 추가하면 이름 표시·선택 목록에 바로 나타난다", () => {
    const rows = Object.entries(CERT_NAMES).map(([code, name]) => row(code, { name_ko: name }));
    expect(listCertNames().some((c) => c.slug === "halal-new")).toBe(false);
    applyCertTypes([...rows, row("halal-new", { name_ko: "할랄(Halal) 신규" })]);
    expect(certName("halal-new")).toBe("할랄(Halal) 신규");
    expect(hasCertName("halal-new")).toBe(true);
    expect(listCertNames().find((c) => c.slug === "halal-new")?.name).toBe("할랄(Halal) 신규");
  });

  it("비활성화하면 선택 목록에서만 빠지고 이름 표시는 계속된다 (기존 FAQ 유지)", () => {
    applyCertTypes([row("vegan", { name_ko: "비건(Vegan)" }), row("organic", { name_ko: "유기농(Organic)", is_active: false }), row("common", { name_ko: "공통" })]);
    expect(isCertActive("vegan")).toBe(true);
    expect(isCertActive("organic")).toBe(false);
    expect(listCertNames().map((c) => c.slug)).toEqual(["vegan"]);
    expect(certName("organic")).toBe("유기농(Organic)");
    expect(hasCertName("organic")).toBe(true);
  });

  it("이름을 고치면 반영되고, common 은 항상 있으며 선택 목록에는 나오지 않는다", () => {
    applyCertTypes([row("vegan", { name_ko: "비건 (수정)" })]);
    expect(certName("vegan")).toBe("비건 (수정)");
    expect(certName("common")).toBe("공통");
    expect(listCertNames().some((c) => c.slug === "common")).toBe(false);
  });

  it("정렬: sort_order 가 작은 순, 같으면 가나다순", () => {
    applyCertTypes([row("b-cert", { name_ko: "나", sort_order: 0 }), row("a-cert", { name_ko: "가", sort_order: 0 }), row("c-cert", { name_ko: "다", sort_order: 1 })]);
    expect(listCertNames().map((c) => c.slug)).toEqual(["a-cert", "b-cert", "c-cert"]);
    applyCertTypes([row("b-cert", { name_ko: "나", sort_order: 5 }), row("a-cert", { name_ko: "가", sort_order: 9 }), row("c-cert", { name_ko: "다", sort_order: 1 })]);
    expect(listCertNames().map((c) => c.slug)).toEqual(["c-cert", "b-cert", "a-cert"]);
  });
});

describe("인증 종류 입력 검증", () => {
  const ok = { code: "pet-related-product", name_ko: "반려동물 친화 인증", name_en: "Pet Friendly", category: "기타", is_active: true, sort_order: 0 };
  it("정상 입력", () => expect(validateCertType(ok, true)).toBeNull());
  it("코드는 영문 소문자·숫자·하이픈만", () => {
    expect(validateCertType({ ...ok, code: "Pet_Friendly" }, true)).toContain("코드");
    expect(validateCertType({ ...ok, code: "한글코드" }, true)).toContain("코드");
    expect(validateCertType({ ...ok, code: "" }, true)).toContain("코드");
  });
  it("common 은 예약 코드", () => expect(validateCertType({ ...ok, code: "common" }, true)).toContain("예약"));
  it("수정할 때는 코드를 다시 검사하지 않는다 (코드는 바꾸지 않음)", () => expect(validateCertType({ ...ok, code: "Whatever" }, false)).toBeNull());
  it("한글 이름 필수·분류는 5가지 중 하나·정렬은 0~9999 정수", () => {
    expect(validateCertType({ ...ok, name_ko: "  " }, true)).toContain("이름");
    expect(validateCertType({ ...ok, category: "음식" }, true)).toContain("분류");
    expect(validateCertType({ ...ok, sort_order: -1 }, true)).toContain("정렬");
    expect(validateCertType({ ...ok, sort_order: 1.5 }, true)).toContain("정렬");
  });
});
