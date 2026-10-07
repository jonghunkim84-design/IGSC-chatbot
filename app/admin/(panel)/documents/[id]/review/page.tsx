import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle } from "@/components/admin/ui";
import { CERT_NAMES, hasCertName, listCertNames } from "@/lib/cert-names";
import { CATEGORY_LABELS } from "@/lib/admin/labels";
import { getLatestJobFull, listDocChunks } from "@/lib/db/admin-doc-faq";
import { listReviewFaqs } from "@/lib/db/admin-doc-review";
import { getDocument } from "@/lib/db/admin-documents";
import { highlightSegments } from "@/lib/docs/highlight";
import type { DocFaqRejected } from "@/lib/db/types";
import { ReviewQueue, type QueueItem, type RejectedView } from "./ReviewQueue";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_LABELS: Record<string, string> = {
  evidence: "근거 불일치",
  numbers: "숫자 불일치",
  consulting: "컨설팅성",
  other_authority: "타 기관 안내",
  duplicate: "중복",
  limit: "상한 도달",
  format: "형식 문제",
  error: "처리 실패",
};
/** [직접 작성]에 미리 채우는 원문 길이 (주소 길이 제한 때문에 앞부분만) */
const PREFILL_MAX = 500;

const certLabel = (slug: string) => (slug === "common" ? "공통" : hasCertName(slug) ? CERT_NAMES[slug] : `${slug} (미등록)`);

export default async function DocumentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const doc = await getDocument(id);
  if (!doc) notFound();

  const [faqs, chunks, job] = await Promise.all([
    listReviewFaqs(id),
    listDocChunks(id),
    getLatestJobFull(id).catch((err) => {
      // 0007 마이그레이션 전이면 작업 기록이 없다: 검수 큐는 그대로 보여준다
      console.error("[doc-review] 작업 조회 실패:", err);
      return null;
    }),
  ]);

  const pageText = (page: number | null) => chunks.filter((c) => c.page_no === page).map((c) => c.content).join("\n");

  const items: QueueItem[] = faqs.map((f) => {
    const evidence = f.source_evidence ?? [];
    // 근거 문장이 있는 조각을 강조해 보여주고, 없으면 출처 쪽의 조각을 그대로 보여준다
    const marked = chunks
      .map((c) => ({ page: c.page_no, segments: highlightSegments(c.content, evidence) }))
      .filter((v) => v.segments.some((s) => s.mark));
    const sources = marked.length > 0 ? marked.slice(0, 3) : f.source_page !== null ? chunks.filter((c) => c.page_no === f.source_page).slice(0, 2).map((c) => ({ page: c.page_no, segments: [{ text: c.content, mark: false }] })) : [];
    return {
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: f.category,
      categoryLabel: CATEGORY_LABELS[f.category] ?? f.category,
      certType: f.cert_type,
      status: f.status === "approved" ? "approved" : "draft",
      needsInput: f.needs_input,
      hold: f.review_hold,
      page: f.source_page,
      note: f.draft_note,
      sources,
    };
  });

  const rejected: RejectedView[] = ((job?.rejected ?? []) as DocFaqRejected[]).map((r) => {
    const original = pageText(r.page).slice(0, PREFILL_MAX);
    const q = new URLSearchParams({ back: `/admin/documents/${id}/review`, cert: doc.cert_type });
    // 처리 실패 항목의 content 는 질문이 아니라 원문 조각이므로 질문 칸은 비워 둔다
    if (r.stage !== "error") q.set("question", r.content);
    if (original) q.set("answer", original);
    return { page: r.page, content: r.content, reason: r.reason, stageLabel: STAGE_LABELS[r.stage] ?? r.stage, writeHref: `/admin/faq/new?${q}`, ...(r.faq_id ? { faqHref: `/admin/faq/${r.faq_id}` } : {}) };
  });

  return (
    <>
      <PageTitle title="문서 초안 검수" />
      <p className="mb-3 text-sm">
        <Link href="/admin/documents" className="font-medium text-teal-800 underline">
          ← 문서 보관함
        </Link>
      </p>
      <ReviewQueue doc={{ id, fileName: doc.file_name, certLabel: certLabel(doc.cert_type), version: doc.version }} items={items} rejected={rejected} jobMissing={!job}
        certOptions={[{ value: "common", label: "공통 (모든 인증)" }, ...listCertNames().map((c) => ({ value: c.slug, label: c.name }))]}
        categoryOptions={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
      />
    </>
  );
}
