import { NextResponse } from "next/server";
import { getAdminEmail } from "@/lib/admin/api-guard";
import { getLatestJobFull } from "@/lib/db/admin-doc-faq";
import type { DocFaqJob } from "@/lib/db/types";
import { startDocFaqJob, stepDocFaqJob } from "@/lib/docs/doc-faq-service";

export const dynamic = "force-dynamic";
// 한 번의 호출은 청크 몇 개만 처리한다. 화면이 끝날 때까지 'step' 을 반복 호출한다.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { headers: { "Cache-Control": "no-store" } };

/** 화면에 내려주는 작업 요약 (탈락 상세는 GET 으로 따로 받는다) */
function summary(job: DocFaqJob) {
  const { rejected, ...rest } = job;
  return { ...rest, rejected_count: rejected?.length ?? 0 };
}

/** 가장 최근 작업과 탈락 목록(사유·원문 일부) */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const job = await getLatestJobFull(id);
    return NextResponse.json({ job: job ? { ...summary(job), rejected: job.rejected } : null }, noStore);
  } catch (err) {
    console.error("[doc-faq] 작업 조회 실패:", err);
    return NextResponse.json({ error: "작업 정보를 불러오지 못했습니다. (DB 마이그레이션 0007 적용 여부를 확인하세요)" }, { status: 500 });
  }
}

/**
 * POST { action: "start" }              작업 시작(재실행이면 이전 자동 초안 교체)
 * POST { action: "step", jobId }        다음 청크 묶음 처리. job.status 가 'running' 이 아니면 끝난 것.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const email = await getAdminEmail();
  if (!email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { action?: string; jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    if (body.action === "start") {
      const r = await startDocFaqJob(id, email);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      return NextResponse.json({ job: summary(r.job) }, noStore);
    }
    if (body.action === "step" && typeof body.jobId === "string" && UUID.test(body.jobId)) {
      const r = await stepDocFaqJob(body.jobId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
      if (r.job.document_id !== id) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ job: summary(r.job), createdNow: r.createdNow, rejectedNow: r.rejectedNow, busy: r.busy ?? false }, noStore);
    }
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  } catch (err) {
    console.error("[doc-faq] 요청 처리 실패:", err);
    return NextResponse.json({ error: "처리 중 오류가 발생했습니다. (DB 마이그레이션 0007 적용 여부를 확인하세요)" }, { status: 500 });
  }
}
