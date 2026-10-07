import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { createDownloadUrl, getDocument } from "@/lib/db/admin-documents";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 관리자 전용. 60초짜리 서명 URL 로 이동시켜 원본 파일명으로 내려받게 한다. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const doc = await getDocument(id);
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
    const res = NextResponse.redirect(await createDownloadUrl(doc), 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("[documents] 다운로드 URL 발급 실패:", err);
    return NextResponse.json({ error: "다운로드 준비에 실패했습니다." }, { status: 500 });
  }
}
