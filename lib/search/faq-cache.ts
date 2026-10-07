import {
  getApprovedFaqFingerprint,
  listApprovedFaqIndex,
  type FaqIndexItem,
} from "@/lib/db/faq";

const TTL_MS = 5 * 60 * 1000;

interface CacheState {
  cached: { items: FaqIndexItem[]; expiresAt: number; fingerprint: string | null } | null;
  inflight: Promise<FaqIndexItem[]> | null;
  generation: number;
}

// 라우트 핸들러(/api/chat)와 서버 액션(관리자 저장)이 같은 캐시를 보도록 globalThis 에 둔다.
const g = globalThis as unknown as { __igscFaqCache?: CacheState };
const state: CacheState = (g.__igscFaqCache ??= { cached: null, inflight: null, generation: 0 });

/**
 * 승인된 FAQ 인덱스(answer 제외). 5분 TTL 메모리 캐시.
 *
 * 기본 loader 를 쓸 때는 캐시가 살아 있어도 승인 FAQ 지문(개수+최신 수정 시각)을 가볍게 확인해서,
 * 다른 서버 인스턴스에서 관리자가 수정한 내용도 재배포·TTL 만료 없이 바로 반영한다.
 * (invalidateFaqCache 는 같은 인스턴스에서의 즉시 무효화용이다.)
 */
export async function getFaqIndex(
  loader: () => Promise<FaqIndexItem[]> = listApprovedFaqIndex,
  fingerprint: (() => Promise<string>) | null = loader === listApprovedFaqIndex ? getApprovedFaqFingerprint : null,
): Promise<FaqIndexItem[]> {
  const c = state.cached;
  if (c && c.expiresAt > Date.now()) {
    if (!fingerprint) return c.items;
    try {
      if ((await fingerprint()) === c.fingerprint) return c.items;
    } catch (err) {
      // 지문 조회 실패 시에는 캐시를 그대로 쓴다 (챗봇이 DB 일시 장애에 같이 멈추지 않도록)
      console.error("[faq-cache] 변경 확인 실패, 캐시 사용:", err);
      return c.items;
    }
  }
  if (state.inflight) return state.inflight;

  const gen = state.generation;
  state.inflight = (async () => {
    const fp = fingerprint ? await fingerprint() : null; // 목록보다 먼저 읽어, 그 사이 변경도 다음 요청에서 감지된다
    const items = await loader();
    // 로딩 중 무효화가 호출됐다면 이 결과는 낡은 것일 수 있으므로 캐시하지 않는다.
    if (gen === state.generation) state.cached = { items, expiresAt: Date.now() + TTL_MS, fingerprint: fp };
    return items;
  })().finally(() => {
    state.inflight = null;
  });
  return state.inflight;
}

/**
 * FAQ 캐시 무효화. 관리자가 FAQ를 수정·승인·삭제한 뒤 호출한다.
 * 프로세스 메모리 캐시라서 호출한 인스턴스에만 적용되지만, 다른 인스턴스는 지문 확인으로 곧바로 따라온다.
 */
export function invalidateFaqCache(): void {
  state.generation++;
  state.cached = null;
  state.inflight = null;
}
