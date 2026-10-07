import { NextResponse } from "next/server";
import { searchFaq } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * [임시] FAQ 선택 결과 확인용. 챗봇 API가 생기면 삭제한다.
 * 프로덕션에서는 SEARCH_DEBUG_ENABLED=true 가 아니면 404 (공개 상태로 Claude 호출이 열리는 것을 막는다).
 * 사용: GET /api/search?q=비건 인증 비용&certType=vegan
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.SEARCH_DEBUG_ENABLED !== "true") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const certType = searchParams.get("certType")?.trim() || undefined;
  if (!q) return NextResponse.json({ error: "q 파라미터가 필요합니다." }, { status: 400 });
  if (q.length > 500) return NextResponse.json({ error: "q 는 500자 이내여야 합니다." }, { status: 400 });

  try {
    const matches = await searchFaq(q, certType);
    return NextResponse.json({ query: q, certType: certType ?? null, count: matches.length, matches });
  } catch (err) {
    console.error("[api/search] 실패:", err);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
