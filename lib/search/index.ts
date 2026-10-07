import { getApprovedFaqAnswers, listApprovedFaqIndex, type FaqAnswerRow, type FaqIndexItem } from "@/lib/db/faq";
import { getFaqIndex, invalidateFaqCache } from "./faq-cache";
import { lexicalMatches } from "./lexical";
import { selectFaqIndexes } from "./select-faq";
import type { FaqMatch } from "./types";

export type { FaqMatch } from "./types";
export { invalidateFaqCache };

/** 답변 근거로 넘기는 FAQ 최대 개수 (선택기가 고른 항목 최대 5 + 공통 항목 보충) */
const MAX_MATCHES = 6;

export interface SearchDeps {
  loadIndex: () => Promise<FaqIndexItem[]>;
  loadAnswers: (ids: string[]) => Promise<FaqAnswerRow[]>;
  select: (query: string, list: FaqIndexItem[], opts?: { commonOnly?: boolean }) => Promise<number[]>;
}

const defaultDeps: SearchDeps = {
  loadIndex: listApprovedFaqIndex,
  loadAnswers: getApprovedFaqAnswers,
  select: selectFaqIndexes,
};

export function createSearchFaq(deps: Partial<SearchDeps> = {}) {
  const d = { ...defaultDeps, ...deps };

  return async function searchFaq(query: string, certType?: string): Promise<FaqMatch[]> {
    const q = query.trim();
    if (!q) return [];

    // 1) 승인된 FAQ 인덱스 (answer 제외). certType이 있으면 해당 인증 + 공통만.
    const all = await getFaqIndex(d.loadIndex);
    const list = certType ? all.filter((f) => f.cert_type === certType || f.cert_type === "common") : all;
    if (list.length === 0) return [];

    // 2) Claude가 관련 항목 선택 (최대 5개, 없으면 []).
    //    공통 항목만 고르는 보충 선택(2-b)은 첫 선택 결과를 기다리지 않고 동시에 시작한다 (약 0.8초 단축).
    //    보충 결과를 실제로 쓸지는 첫 선택 결과를 본 뒤에 정한다(아래). 보충 선택이 실패해도 첫 선택만으로 계속한다.
    const commonList = list.filter((f) => f.cert_type === "common");
    const [picked, commonPicked] = await Promise.all([
      d.select(q, list),
      commonList.length > 0
        ? d.select(q, commonList, { commonOnly: true }).catch((err) => {
            console.error("[search] 공통 항목 보충 선택 실패(첫 선택만 사용):", err instanceof Error ? err.message : err);
            return [] as number[];
          })
        : Promise.resolve([] as number[]),
    ]);
    const modelIds = picked.map((i) => list[i]?.id).filter((id): id is string => Boolean(id));
    // 질문이 FAQ 의 질문·다른 표현과 사실상 같으면 모델 선택과 상관없이 먼저 포함한다 (긴 목록에서 모델이 놓치는 경우 보완)
    const ids = [...lexicalMatches(q, list)];
    for (const id of modelIds) if (!ids.includes(id) && ids.length < MAX_MATCHES) ids.push(id);

    // 2-b) 특정 인증 항목이 골라졌으면, 공통 항목(모든 인증에 적용)만 고른 결과(commonPicked)를 뒤에 붙인다.
    //      (아무것도 못 골랐다면 FAQ에 없는 인증일 수 있으므로 공통 항목으로 채우지 않는다.)
    //      "비건 인증 절차랑 서류"처럼 인증 이름이 들어간 질문에서 선택기가 그 인증 전용 항목에만 쏠려
    //      공통 항목(인증 절차 등)을 놓치는 문제를 막는다. 전용 항목이 먼저, 공통 항목이 뒤에 붙는다.
    const pickedAreAllCommon = ids.length > 0 && ids.every((id) => list.find((f) => f.id === id)?.cert_type === "common");
    if (commonList.length > 0 && ids.length > 0 && !pickedAreAllCommon) {
      const extra = commonPicked.map((i) => commonList[i]?.id).filter((id): id is string => Boolean(id));
      for (const id of extra) if (!ids.includes(id) && ids.length < MAX_MATCHES) ids.push(id);
    }
    if (ids.length === 0) return [];

    // 3) 선택된 id의 answer, source_url 조회 (선택 순서 유지)
    const rows = new Map((await d.loadAnswers(ids)).map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const r = rows.get(id);
      return r ? [{ ...r }] : [];
    });
  };
}

/**
 * FAQ 선택. 빈 배열 = 근거 없음 (호출측은 답변을 생성하지 않고 담당자 이관).
 * 향후 벡터 검색으로 교체할 때도 이 시그니처를 유지하고 이 모듈 안쪽만 바꾼다.
 */
export const searchFaq = createSearchFaq();
