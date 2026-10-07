"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { invalidateCertNames } from "@/lib/cert-registry";
import { insertCertType, updateCertType, validateCertType, type CertTypeInput } from "@/lib/db/cert-types";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const BACK = "/admin/cert-types";
const go = (params: Record<string, string>): never => redirect(`${BACK}?${new URLSearchParams(params)}`);

function readInput(formData: FormData): CertTypeInput {
  return {
    code: str(formData.get("code")).trim(),
    name_ko: str(formData.get("name_ko")),
    name_en: str(formData.get("name_en")).trim() || null,
    category: str(formData.get("category")),
    is_active: formData.get("is_active") === "on",
    sort_order: Number(str(formData.get("sort_order")) || "0"),
  };
}

/** 새 인증 종류 추가. 저장하면 문서 업로드·FAQ 등록 선택지에 바로 나타난다(캐시 무효화). */
export async function createCertTypeAction(formData: FormData) {
  await requireAdmin();
  const input = readInput(formData);
  const problem = validateCertType(input, true);
  if (problem) go({ err: problem, code: input.code });
  try {
    const r = await insertCertType(input);
    if (!r.ok) go({ err: r.error, code: input.code });
  } catch (err) {
    // redirect() 는 예외로 동작하므로 다시 던진다
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[cert-types] 추가 실패:", err);
    go({ err: "저장하지 못했습니다. (DB 마이그레이션 0009 적용 여부를 확인하세요)" });
  }
  invalidateCertNames();
  go({ msg: "created", code: input.code });
}

/** 이름·분류·정렬·활성 수정. 코드는 바꿀 수 없다. 비활성화해도 기존 FAQ·이력은 유지된다. */
export async function updateCertTypeAction(formData: FormData) {
  await requireAdmin();
  const input = readInput(formData);
  const problem = validateCertType(input, false);
  if (problem) go({ err: problem, code: input.code });
  try {
    const ok = await updateCertType(input);
    if (!ok) go({ err: "수정할 수 없는 항목입니다.", code: input.code });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error("[cert-types] 수정 실패:", err);
    go({ err: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: input.code });
  }
  invalidateCertNames();
  go({ msg: input.is_active ? "updated" : "deactivated", code: input.code });
}
