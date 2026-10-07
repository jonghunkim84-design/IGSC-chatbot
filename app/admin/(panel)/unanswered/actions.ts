"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/guard";
import { MAX_BULK_DRAFTS, draftForUnanswered, draftForUnansweredMany } from "@/lib/docs/draft-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
const safeBack = (v: string) => (v.startsWith("/admin/unanswered") ? v : "/admin/unanswered");

function go(back: string, params: Record<string, string>): never {
  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}${new URLSearchParams(params)}`);
}

/**
 * 미답변 질문 1건의 초안 만들기 (바로 실행하고 결과를 보여준다).
 * 문서에서 근거를 찾아 faq 에 status='draft' 로만 만든다. 승인은 하지 않는다.
 */
export async function draftOneAction(id: string, formData: FormData) {
  await requireAdmin();
  const back = safeBack(str(formData.get("returnTo")));
  if (!UUID.test(id)) {
    console.error("[doc-draft] 초안 만들기: 올바르지 않은 질문 id", id);
    go(back, { msg: "draft_error" });
  }
  const r = await draftForUnanswered(id, str(formData.get("certType")) || undefined);
  const params: Record<string, string> = { msg: `draft_${r.status}` };
  if (r.faqId) params.fid = r.faqId;
  if (r.sources?.[0]) {
    params.file = r.sources.map((s) => (s.page_no ? `${s.file_name} p.${s.page_no}` : s.file_name)).join(", ");
  }
  go(back, params);
}

/** 선택한 여러 건 일괄 초안 만들기 (응답 후 백그라운드 실행, 한 번에 최대 10건). 야간 배치는 없다. */
export async function draftBulkAction(formData: FormData) {
  await requireAdmin();
  const back = safeBack(str(formData.get("returnTo")));
  const ids = formData.getAll("ids").filter((v): v is string => typeof v === "string" && UUID.test(v));
  if (ids.length === 0) go(back, { msg: "draft_none" });
  const picked = [...new Set(ids)].slice(0, MAX_BULK_DRAFTS);
  const cert = str(formData.get("certType")) || undefined;
  after(() => draftForUnansweredMany(picked, cert).then(() => undefined));
  go(back, { msg: "draft_bulk", n: String(picked.length), skipped: String(Math.max(0, new Set(ids).size - picked.length)), ids: picked.join(",") });
}
