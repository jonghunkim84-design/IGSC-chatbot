import "server-only";
import { applyCertTypes } from "@/lib/cert-names";
import { listCertTypes } from "@/lib/db/cert-types";

/** 인증 종류 캐시 유효 시간 (10분). 관리자 화면에서 수정하면 즉시 무효화한다. */
export const CERT_TTL_MS = 10 * 60 * 1000;

interface State {
  expiresAt: number;
  inflight: Promise<void> | null;
  generation: number;
}

// 라우트·서버 액션·서버 컴포넌트가 같은 캐시를 보도록 globalThis 에 둔다 (faq-cache 와 같은 방식)
const g = globalThis as unknown as { __igscCertCache?: State };
const state: State = (g.__igscCertCache ??= { expiresAt: 0, inflight: null, generation: 0 });

/**
 * DB(cert_types)의 인증 종류를 lib/cert-names.ts 의 메모리 사본에 반영한다 (10분 캐시).
 * 서버 진입점(관리자 레이아웃, 서버 액션, API 라우트, 챗봇)에서 호출한다.
 * DB 조회가 실패하면(테이블 없음 등) 로그만 남기고 현재 사본(기본값)으로 계속한다 — 챗봇이 이 때문에 멈추지 않게.
 */
export async function ensureCertNames(): Promise<void> {
  if (state.expiresAt > Date.now()) return;
  if (state.inflight) return state.inflight;
  const gen = state.generation;
  state.inflight = (async () => {
    try {
      const rows = await listCertTypes();
      if (gen === state.generation) {
        applyCertTypes(rows);
        state.expiresAt = Date.now() + CERT_TTL_MS;
      }
    } catch (err) {
      console.error("[cert-registry] 인증 종류 조회 실패, 기본값 사용:", err instanceof Error ? err.message : err);
      // 실패해도 잠시(30초) 다시 시도하지 않는다: 장애·마이그레이션 전 상태에서 요청마다 DB 를 두드리지 않게
      if (gen === state.generation) state.expiresAt = Date.now() + 30_000;
    }
  })().finally(() => {
    state.inflight = null;
  });
  return state.inflight;
}

/** 관리자가 인증 종류를 추가·수정한 직후 호출: 같은 인스턴스는 바로, 다른 인스턴스는 TTL 안에 따라온다. */
export function invalidateCertNames(): void {
  state.generation++;
  state.expiresAt = 0;
  state.inflight = null;
}
