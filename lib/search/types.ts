import type { FaqCategory } from "@/lib/db/types";

/**
 * FAQ 검색 결과. 빈 배열 = 근거 없음 → 호출측은 답변을 생성하지 말고 담당자 이관 처리한다.
 * 이 타입과 searchFaq() 시그니처는 벡터 검색으로 교체해도 유지한다.
 */
export interface FaqMatch {
  id: string;
  question: string;
  answer: string;
  source_url: string | null;
  cert_type: string;
  /** cost | duration | procedure | ... — 답변 시 비용·기간 면책 문구 첨부 판단에 사용 */
  category: FaqCategory;
  /** true면 담당자 입력이 필요한 항목. 답변 생성에 쓰지 않고 담당자 안내 문구로 응답한다. */
  needs_input: boolean;
}
