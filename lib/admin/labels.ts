export const CATEGORY_LABELS: Record<string, string> = {
  procedure: "절차",
  cost: "비용",
  duration: "기간",
  document: "서류",
  scope: "대상·범위",
  renewal: "갱신",
};

export const STATUS_LABELS: Record<string, string> = { draft: "초안", approved: "승인" };

export const ROUTE_LABELS: Record<string, string> = {
  answered: "답변 완료",
  handoff: "담당자 이관",
  consulting_blocked: "컨설팅 차단",
  complaint: "불만 접수",
  out_of_scope: "범위 밖",
  clarify: "인증 종류 되묻기",
};

export const ROUTE_ORDER = ["answered", "handoff", "clarify", "consulting_blocked", "complaint", "out_of_scope"] as const;

export const PAGE_SIZE = 20;

/** KST(UTC+9) 기준 날짜/시각 유틸. 서버가 어느 시간대에서 돌아도 같은 결과를 낸다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 해당 날짜(YYYY-MM-DD)의 시작 시각(UTC ISO) */
export function kstDayStartISO(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toISOString();
}

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 지금 시각의 KST 날짜(YYYY-MM-DD) */
export function kstTodayYmd(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 기준 이번 주 월요일 날짜 */
export function kstWeekStartYmd(now = new Date()): string {
  const today = kstTodayYmd(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일
  return addDaysYmd(today, -((dow + 6) % 7));
}

export function formatKst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

export const DOC_CATEGORY_LABELS: Record<string, string> = {
  procedure: "절차",
  fee: "비용·수수료",
  form: "양식",
  policy: "규정·정책",
  other: "기타 (초안 제외)",
};

export const DOC_STATUS_LABELS: Record<string, string> = {
  pending: "추출 대기",
  extracted: "추출 완료",
  failed: "추출 실패",
  archived: "이전 버전",
};
