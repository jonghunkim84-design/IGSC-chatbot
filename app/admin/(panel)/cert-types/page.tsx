import { Flash, PageTitle, btnPrimary, inputCls } from "@/components/admin/ui";
import { CERT_CATEGORIES } from "@/lib/cert-names";
import { certTypeUsage, listCertTypes, RESERVED_CODE } from "@/lib/db/cert-types";
import { createCertTypeAction, updateCertTypeAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { msg?: string; err?: string; code?: string };

function flashFor(sp: SP): { text: string; tone: "ok" | "warn" } | null {
  if (sp.err) return { text: sp.err, tone: "warn" };
  switch (sp.msg) {
    case "created":
      return { text: `'${sp.code}' 을(를) 추가했습니다. 문서 업로드·FAQ 등록 선택지에 바로 나타납니다.`, tone: "ok" };
    case "updated":
      return { text: `'${sp.code}' 을(를) 수정했습니다.`, tone: "ok" };
    case "deactivated":
      return { text: `'${sp.code}' 을(를) 비활성화했습니다. 기존 FAQ·이력·문서는 그대로 유지되고, 신규 등록 선택지에서만 빠집니다.`, tone: "ok" };
    default:
      return null;
  }
}

export default async function CertTypesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  let rows: Awaited<ReturnType<typeof listCertTypes>> = [];
  let loadError = "";
  try {
    rows = await listCertTypes();
  } catch (err) {
    console.error("[cert-types] 목록 조회 실패:", err);
    loadError = "인증 종류 테이블을 읽지 못했습니다. DB 마이그레이션 0009(cert_types)를 실행했는지 확인해 주세요.";
  }
  const usage = rows.length ? await certTypeUsage().catch(() => new Map()) : new Map();
  const flash = flashFor(sp);

  return (
    <>
      <PageTitle title="인증 종류" />
      <p className="mb-4 text-sm text-slate-600">
        FAQ·문서·이력에서 쓰는 인증 종류 목록입니다. 새 인증 체계가 생기면 여기서 추가하세요. 추가하면 문서 업로드와 FAQ 등록의 선택지에 <b>바로</b> 나타납니다.
        비활성화해도 기존 FAQ·이력·문서는 그대로 유지되고, 신규 등록 선택지에서만 빠집니다. 코드는 만든 뒤 바꿀 수 없습니다.
      </p>
      <Flash message={flash?.text} tone={flash?.tone} />
      {loadError && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {loadError}
        </p>
      )}

      <form action={createCertTypeAction} className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.5fr_1.2fr_1fr_6rem_auto]">
        <label className="text-xs font-medium text-slate-600">
          코드 (영문 소문자·숫자·하이픈)
          <input name="code" required pattern="[a-z0-9-]+" maxLength={60} placeholder="pet-related-product" defaultValue={sp.err ? sp.code : ""} className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          한글 이름
          <input name="name_ko" required maxLength={100} placeholder="반려동물 친화 인증" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          영문 이름 (선택)
          <input name="name_en" maxLength={100} placeholder="Pet Friendly" className={`${inputCls} mt-1`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          분류
          <select name="category" defaultValue="기타" className={`${inputCls} mt-1`}>
            {CERT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          정렬
          <input name="sort_order" type="number" min={0} max={9999} defaultValue={0} className={`${inputCls} mt-1`} />
        </label>
        <input type="hidden" name="is_active" value="on" />
        <div className="flex items-end">
          <button type="submit" className={btnPrimary}>
            추가
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="w-48 px-3 py-2">코드</th>
              <th className="px-3 py-2">한글 이름</th>
              <th className="w-44 px-3 py-2">영문 이름</th>
              <th className="w-28 px-3 py-2">분류</th>
              <th className="w-20 px-3 py-2">정렬</th>
              <th className="w-20 px-3 py-2">사용 중</th>
              <th className="w-16 px-3 py-2">활성</th>
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loadError && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                  등록된 인증 종류가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const u = usage.get(r.code) ?? { faq: 0, documents: 0, history: 0 };
              const reserved = r.code === RESERVED_CODE;
              const formId = `ct-${r.code}`;
              return (
                <tr key={r.code} className={`border-t border-slate-100 align-top ${r.is_active ? "" : "bg-slate-50 text-slate-500"}`}>
                  <td className="px-3 py-2">
                    <code className="text-xs">{r.code}</code>
                    {reserved && <p className="text-[11px] text-slate-500">공통 항목용 예약 코드</p>}
                    <form id={formId} action={updateCertTypeAction}>
                      <input type="hidden" name="code" value={r.code} />
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    <input form={formId} name="name_ko" defaultValue={r.name_ko} required maxLength={100} disabled={reserved} className={inputCls} aria-label={`${r.code} 한글 이름`} />
                  </td>
                  <td className="px-3 py-2">
                    <input form={formId} name="name_en" defaultValue={r.name_en ?? ""} maxLength={100} disabled={reserved} className={inputCls} aria-label={`${r.code} 영문 이름`} />
                  </td>
                  <td className="px-3 py-2">
                    <select form={formId} name="category" defaultValue={r.category} disabled={reserved} className={inputCls} aria-label={`${r.code} 분류`}>
                      {CERT_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input form={formId} name="sort_order" type="number" min={0} max={9999} defaultValue={r.sort_order} disabled={reserved} className={inputCls} aria-label={`${r.code} 정렬`} />
                  </td>
                  <td className="px-3 py-2 text-xs leading-relaxed text-slate-600">
                    FAQ {u.faq}
                    <br />
                    문서 {u.documents} · 이력 {u.history}
                  </td>
                  <td className="px-3 py-2">
                    {reserved ? (
                      // 공통(common)은 항상 활성이며 수정·비활성화할 수 없다: 회색 체크박스 대신 '고정'으로 표시한다
                      <span className="mt-1.5 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700" title="공통 항목용 예약 코드라 항상 활성이며 바꿀 수 없습니다">
                        고정
                      </span>
                    ) : (
                      <input form={formId} type="checkbox" name="is_active" defaultChecked={r.is_active} className="mt-2 h-4 w-4" aria-label={`${r.code} 활성`} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!reserved && (
                      <button form={formId} type="submit" className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
                        저장
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">정렬: 0 은 가나다순(기본), 1 이상이면 숫자가 작은 순서로 앞에 옵니다. 활성 체크를 풀고 저장하면 비활성화됩니다.</p>
    </>
  );
}
