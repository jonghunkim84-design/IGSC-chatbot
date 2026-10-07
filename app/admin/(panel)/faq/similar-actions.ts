"use server";

import { requireAdmin } from "@/lib/admin/guard";
import { ensureCertNames } from "@/lib/cert-registry";
import { findSimilarFaq } from "@/lib/docs/similar-faq";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SimilarView {
  id: string;
  question: string;
  status: "draft" | "approved";
}

/**
 * FAQ 직접 등록·수정 화면의 유사 FAQ 경고. 같은 인증 종류의 approved + draft FAQ 중 의미가 같은 질문을 찾는다.
 * 경고용이라 저장을 막지 않는다. 검사에 실패하면 경고 없이 빈 목록을 돌려준다(저장에는 영향 없음).
 */
export async function checkSimilarFaqAction(question: string, certType: string, excludeId?: string): Promise<SimilarView[]> {
  await requireAdmin();
  const q = typeof question === "string" ? question.trim().slice(0, 300) : "";
  if (q.length < 4 || !/^[a-z0-9-]+$/.test(certType ?? "")) return [];
  try {
    await ensureCertNames();
    const found = await findSimilarFaq(q, certType, { excludeId: excludeId && UUID.test(excludeId) ? excludeId : undefined });
    return found.map((f) => ({ id: f.id, question: f.question, status: f.status }));
  } catch (err) {
    console.error("[faq] 유사 FAQ 검사 실패:", err);
    return [];
  }
}
