/**
 * cert_type slug → 한글 인증명.
 *
 * 출처: igsc.kr 크롤링 원문의 페이지 제목("대분류 / 이름")에서 이름 부분.
 * 한 slug에 제목이 여러 개면 한글이 포함된 이름을 골랐다 (예: epd → 환경성적표지(EPD)).
 * 원문 제목이 영문뿐인 인증(EarthCheck, Flustix, WSO, JAS 등)은 영문 그대로다.
 *
 * 쓰는 곳:
 *  - cert_history 이력 안내 문구 (lib/chat/history.ts)
 *  - 비용·기간 placeholder FAQ 질문 (lib/ingest/relabel-placeholders.ts, generate-faq.ts)
 *  - 관리자 화면 표시·선택 목록 (Phase 6: listCertNames())
 *
 * ── 새 인증을 추가하는 방법 ──────────────────────────────────────
 *  관리자 화면 /admin/cert-types 에서 추가·수정·비활성화한다 (원본은 DB 테이블 cert_types, 마이그레이션 0009).
 *  - code: 영문 소문자·숫자·하이픈. faq.cert_type / cert_history.cert_type 에 넣는 값과 정확히 같아야 하며 만든 뒤에는 바꿀 수 없다.
 *  - 이름: 고객에게 보이는 표기. 사이트 제목과 같은 형식이면 "한글(English)" 권장.
 *  - 비활성화해도 기존 FAQ·이력·문서는 유지되고, 신규 등록 선택지에서만 빠진다.
 *  - 이 파일의 CERT_NAMES 는 DB 연결 전/실패 시의 기본값(= 마이그레이션의 초기 데이터)이다. 새 인증을 여기에 추가할 필요 없다.
 *  - `npm run cert-names:check` 로 DB·초안에 등록되지 않은 코드가 남았는지 확인한다.
 * 매핑이 없는 slug는 slug 그대로 표시되고 경고 로그(한 번)가 남는다.
 * 'common'(공통 항목)은 특정 인증이 아니므로 placeholder 질문에서는 이름 없이 "인증"으로 쓴다.
 */
export const CERT_NAMES: Record<string, string> = {
  common: "공통",
  // 식품
  "allergens-friendly": "알레르기 친화(Allergens friendly)",
  "calorie-free": "칼로리프리(Calorie free)",
  "fat-free": "무지방(Fat free)",
  "gluten-free": "글루텐프리(Gluten free)",
  "ketogenic-friendly": "키토제닉 친화(Ketogenic friendly)",
  "lactose-free-dairy-free": "무유당 / 무유제품(Lactose-free / Dairy-free)",
  "no-added-sugar": "무가당(No Added Sugar)",
  "non-gmo": "무유전자변형(Non-GMO)",
  "organic": "유기농(Organic)",
  "salt-free": "무소금(Salt-free)",
  "sugar-free": "무설탕(Sugar free)",
  "vegan": "비건(Vegan)",
  // 화장품
  "clean-additive-free": "클린(Additive free)",
  "clean-beauty": "클린뷰티(Clean beauty)",
  "coral-reef-friendly": "산호초 보호(Coral Reef-friendly)",
  "microbiome-friendly": "Microbiome friendly (MyMicrobiome)",
  "natural-organic": "천연 / 유기농(Natural / Organic)",
  // 지속가능성
  "cradle-to-cradle": "Cradle to Cradle Certified",
  "earthcheck": "EarthCheck",
  "flustix": "Flustix",
  "ocean-bound-plastic": "Ocean Bound Plastic",
  "plastic-credit-exchange": "Plastic Credit Exchange",
  "plastic-free": "플라스틱 프리(Plastic free)",
  "upcycle": "업사이클(Upcycle)",
  "zero-waste": "제로웨이스트(Zero-waste)",
  "zero-waste-japan": "Zero Waste Japan",
  // 환경 및 건강
  "environmental-footprint": "조직 및 제품 환경발자국 (OEF, PEF)",
  "epd": "환경성적표지(EPD)",
  "phd": "제품건강선언(PHD)",
  // 반려동물
  "pet-related-product": "반려동물 관련 제품(Pet Related Product)",
  "pet-related-service": "반려동물 관련 서비스 (Pet Related Service)",
  // 방어구
  "defense-equipment": "보호장비 (Defense Equipment)",
  // ISO 경영시스템
  "iso-13485": "ISO 13485 (의료기기 품질관리시스템)",
  "iso-14001": "ISO 14001 (환경경영시스템)",
  "iso-20000-1": "ISO 20000-1 (IT 서비스 관리 경영시스템)",
  "iso-22000": "ISO 22000 (식품안전경영시스템)",
  "iso-22716": "ISO 22716 (화장품 우수제조관리기준)",
  "iso-27001": "ISO 27001 (정보보호경영시스템)",
  "iso-45001": "ISO 45001 (안전보건경영시스템)",
  "iso-50001": "ISO 50001 (에너지경영시스템)",
  "iso-9001": "ISO 9001 (품질경영시스템)",
  // 협력서비스
  "allergy-certified": "Allergy Certified",
  "geo-foundation": "GEO Foundation",
  "global-greentag": "Global GreenTag International",
  "jas": "JAS",
  "keto-project-verified": "KETO Project Verified",
  "monde-selection": "Monde Selection",
  "mymicrobiome": "Mymicrobiome",
  "sugarwise": "Sugarwise",
  "wso": "WSO",
};

const warned = new Set<string>();

// ── DB(cert_types) 연동 ─────────────────────────────────────────
// 인증 종류의 원본은 DB 테이블 cert_types 이고(관리자 화면 /admin/cert-types), 이 파일의 CERT_NAMES 는
//  1) DB 에 연결되기 전/실패 시의 기본값(초기 데이터와 같은 내용)이자
//  2) 서버가 DB 에서 읽은 값으로 '제자리에서' 갱신하는 메모리 사본이다.
// 동기 함수(certName, hasCertName, listCertNames …)와 CERT_NAMES 를 쓰는 기존 코드는 그대로 두고,
// 서버 진입점에서 `await ensureCertNames()` (lib/cert-registry.ts, 10분 캐시)만 호출하면 DB 값이 반영된다.

export const CERT_CATEGORIES = ["식품", "화장품", "지속가능성", "검증", "기타"] as const;
export type CertCategory = (typeof CERT_CATEGORIES)[number];

export interface CertTypeRow {
  code: string;
  name_ko: string;
  name_en: string | null;
  category: string;
  is_active: boolean;
  sort_order: number;
}

const inactive = new Set<string>();
const sortOrder = new Map<string, number>();

/** DB 에서 읽은 인증 종류로 메모리 사본을 교체한다. rows 가 비어 있으면(테이블 없음 등) 기본값을 유지한다. */
export function applyCertTypes(rows: CertTypeRow[]): void {
  if (rows.length === 0) return;
  for (const k of Object.keys(CERT_NAMES)) delete CERT_NAMES[k];
  inactive.clear();
  sortOrder.clear();
  for (const r of rows) {
    CERT_NAMES[r.code] = r.name_ko;
    if (!r.is_active) inactive.add(r.code);
    sortOrder.set(r.code, r.sort_order);
  }
  if (!("common" in CERT_NAMES)) CERT_NAMES.common = "공통";
}

/** 비활성화된 인증 종류인가 (기존 FAQ·이력은 유지되고, 신규 등록 선택지에서만 빠진다) */
export function isCertActive(slug: string): boolean {
  return hasCertName(slug) && !inactive.has(slug);
}

/** 매핑이 등록된 slug인지 (비활성 포함) */
export function hasCertName(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(CERT_NAMES, slug);
}

/** slug의 한글 인증명 (비활성 포함). 매핑이 없으면 slug 그대로 반환하고 경고 로그를 한 번 남긴다. */
export function certName(slug: string): string {
  if (hasCertName(slug)) return CERT_NAMES[slug];
  if (!warned.has(slug)) {
    warned.add(slug);
    console.warn(`[cert-names] 매핑 없는 cert_type: "${slug}" — 관리자 화면 '인증 종류'에서 추가하세요.`);
  }
  return slug;
}

/**
 * 신규 등록 선택 목록용 (공통·비활성 제외).
 * sort_order 가 작은 순, 같으면(기본 0) 이름 가나다순.
 */
export function listCertNames(): { slug: string; name: string }[] {
  return Object.entries(CERT_NAMES)
    .filter(([slug]) => slug !== "common" && !inactive.has(slug))
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => (sortOrder.get(a.slug) ?? 0) - (sortOrder.get(b.slug) ?? 0) || a.name.localeCompare(b.name, "ko"));
}
