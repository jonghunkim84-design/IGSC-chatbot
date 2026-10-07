import "server-only";
import { createServerClient } from "./server";
import { CERT_CATEGORIES, type CertTypeRow } from "@/lib/cert-names";

export interface CertTypeInput {
  code: string;
  name_ko: string;
  name_en: string | null;
  category: string;
  is_active: boolean;
  sort_order: number;
}

export type CertTypeUsage = { faq: number; documents: number; history: number };

/** 'common' 은 특정 인증이 아닌 공통 항목용 예약 코드라 화면에서 만들거나 바꿀 수 없다 */
export const RESERVED_CODE = "common";

/** 입력 검증. 통과하면 null, 실패하면 사유. isNew 일 때만 code 를 검사한다 (code 는 만든 뒤 바꿀 수 없다). */
export function validateCertType(i: CertTypeInput, isNew: boolean): string | null {
  if (isNew) {
    if (!/^[a-z0-9-]+$/.test(i.code)) return "코드는 영문 소문자·숫자·하이픈만 쓸 수 있습니다. (예: pet-related-product)";
    if (i.code.length > 60) return "코드는 60자 이내로 입력해 주세요.";
    if (i.code === RESERVED_CODE) return "'common' 은 공통 항목용 예약 코드입니다.";
  }
  if (!i.name_ko.trim()) return "한글 이름을 입력해 주세요.";
  if (i.name_ko.length > 100) return "한글 이름은 100자 이내로 입력해 주세요.";
  if (i.name_en && i.name_en.length > 100) return "영문 이름은 100자 이내로 입력해 주세요.";
  if (!(CERT_CATEGORIES as readonly string[]).includes(i.category)) return "분류를 선택해 주세요.";
  if (!Number.isInteger(i.sort_order) || i.sort_order < 0 || i.sort_order > 9999) return "정렬 순서는 0~9999 사이 정수로 입력해 주세요. (0 = 가나다순)";
  return null;
}

/** 전체 목록 (비활성 포함). 테이블이 없으면 오류를 던진다 — 호출 측에서 기본값으로 대체한다. */
export async function listCertTypes(): Promise<CertTypeRow[]> {
  const { data, error } = await createServerClient().from("cert_types").select("code, name_ko, name_en, category, is_active, sort_order").order("sort_order").order("code");
  if (error) throw error;
  return (data ?? []) as CertTypeRow[];
}

export async function insertCertType(i: CertTypeInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await createServerClient().from("cert_types").insert({
    code: i.code,
    name_ko: i.name_ko.trim(),
    name_en: i.name_en?.trim() || null,
    category: i.category,
    is_active: i.is_active,
    sort_order: i.sort_order,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "이미 있는 코드입니다." };
    throw error;
  }
  return { ok: true };
}

/** 이름·분류·활성·정렬 수정. code 는 바꾸지 않는다. */
export async function updateCertType(i: CertTypeInput): Promise<boolean> {
  const { data, error } = await createServerClient()
    .from("cert_types")
    .update({ name_ko: i.name_ko.trim(), name_en: i.name_en?.trim() || null, category: i.category, is_active: i.is_active, sort_order: i.sort_order })
    .eq("code", i.code)
    .neq("code", RESERVED_CODE)
    .select("code");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/** 코드별로 이 인증을 쓰는 FAQ·문서·이력 건수 (비활성화·수정 전에 영향 범위를 보여주는 용도) */
export async function certTypeUsage(): Promise<Map<string, CertTypeUsage>> {
  const sb = createServerClient();
  const out = new Map<string, CertTypeUsage>();
  const bump = (code: string, key: keyof CertTypeUsage) => {
    const u = out.get(code) ?? { faq: 0, documents: 0, history: 0 };
    u[key]++;
    out.set(code, u);
  };
  for (const [table, key] of [["faq", "faq"], ["documents", "documents"], ["cert_history", "history"]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select("cert_type").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) bump(r.cert_type as string, key);
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}
