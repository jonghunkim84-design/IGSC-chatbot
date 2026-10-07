/** 운영 상태 판정 (순수 함수). 수집은 collect.ts, 알림은 alert.ts. */

export interface Signals {
  dbOk: boolean;
  dbError?: string;
  aiOk: boolean;
  aiError?: string;
  /** 최근 1시간 대화 수와 '일시적인 문제' 응답(오류) 수 */
  lastHour: { total: number; errors: number };
  /** 오늘(UTC 하루) 챗봇 질문 수와 하루 상한 (요청 제한 카운터) */
  daily: { used: number; cap: number };
  approvedFaq: number;
  openUnanswered: number;
}

export interface Issue {
  level: "critical" | "warning";
  /** 같은 문제를 구분하는 키 (알림 중복 방지에 사용) */
  code: string;
  message: string;
}

export interface Thresholds {
  errorMinCount: number;
  errorRate: number;
  dailyWarnRatio: number;
  unansweredWarn: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  errorMinCount: 3,
  errorRate: 0.2,
  dailyWarnRatio: 0.8,
  unansweredWarn: 30,
};

export function evaluate(s: Signals, t: Thresholds = DEFAULT_THRESHOLDS): Issue[] {
  const issues: Issue[] = [];
  if (!s.dbOk) issues.push({ level: "critical", code: "db-down", message: `데이터베이스에 연결할 수 없습니다. (${s.dbError ?? "원인 미상"})` });
  if (!s.aiOk) {
    issues.push({
      level: "critical",
      code: "ai-down",
      message: `AI 호출이 실패합니다. 크레딧 소진·키 오류일 수 있습니다. 이 상태에서는 모든 질문이 담당자 이관으로 처리됩니다. (${s.aiError ?? "원인 미상"})`,
    });
  }
  if (s.dbOk) {
    const { total, errors } = s.lastHour;
    if (errors >= t.errorMinCount && total > 0 && errors / total >= t.errorRate) {
      issues.push({ level: "critical", code: "chat-errors", message: `최근 1시간 대화 ${total}건 중 ${errors}건이 오류로 담당자 이관됐습니다.` });
    }
    if (s.daily.cap > 0) {
      if (s.daily.used >= s.daily.cap) {
        issues.push({ level: "critical", code: "daily-cap", message: `오늘 질문 수가 하루 상한(${s.daily.cap}건)에 도달해 새 질문을 거절하고 있습니다.` });
      } else if (s.daily.used / s.daily.cap >= t.dailyWarnRatio) {
        issues.push({ level: "warning", code: "daily-near", message: `오늘 질문 수가 하루 상한의 ${Math.round((s.daily.used / s.daily.cap) * 100)}%입니다. (${s.daily.used}/${s.daily.cap})` });
      }
    }
    if (s.approvedFaq === 0) issues.push({ level: "warning", code: "no-approved-faq", message: "승인된 FAQ가 0건입니다. 챗봇이 답변하지 못합니다." });
    if (s.openUnanswered >= t.unansweredWarn) issues.push({ level: "warning", code: "unanswered-backlog", message: `처리 대기 중인 미답변 질문이 ${s.openUnanswered}건입니다.` });
  }
  return issues;
}

export type OverallStatus = "ok" | "warning" | "critical";
export const overall = (issues: Issue[]): OverallStatus =>
  issues.some((i) => i.level === "critical") ? "critical" : issues.length ? "warning" : "ok";
