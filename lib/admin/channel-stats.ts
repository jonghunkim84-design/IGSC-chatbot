import { CHANNELS, SOURCE_DIRECT, SOURCE_OTHER } from "@/lib/channels";

export interface ChannelRow {
  session_id: string;
  route: string;
  source: string | null;
  source_detail: string | null;
}

export interface ChannelStat {
  /** 채널 코드 ('direct' = 직접 입력·알 수 없음) */
  source: string;
  /** 대화를 시작한 방문(브라우저 탭) 수 = 서로 다른 session_id */
  sessions: number;
  /** 질문 수 (챗봇에 입력된 메시지 1건 = 1) */
  questions: number;
  answered: number;
  handoff: number;
  complaint: number;
  /** 답변 성공률 = 답변 완료 ÷ (답변 완료 + 담당자 이관). 분모가 0이면 null */
  successRate: number | null;
  /** 전체 질문 중 이 채널의 비중 (0~1) */
  share: number;
  /** 캠페인(source_detail)별 질문·대화 수 */
  campaigns: { name: string; questions: number; sessions: number }[];
}

/** 화면에 보여 줄 채널 순서: 등록된 채널 → 기타 → 직접. 질문이 0건인 등록 채널도 보여 준다. */
const ORDER = [...CHANNELS.map((c) => c.code), SOURCE_OTHER, SOURCE_DIRECT];

export function aggregateChannels(rows: ChannelRow[]): { stats: ChannelStat[]; total: { sessions: number; questions: number } } {
  const key = (r: ChannelRow) => (r.source && r.source !== SOURCE_DIRECT ? r.source : SOURCE_DIRECT);
  const groups = new Map<string, ChannelRow[]>();
  for (const code of ORDER) groups.set(code, []);
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []); // 코드에서 빠진 옛 채널 값도 버리지 않는다
    groups.get(k)!.push(r);
  }
  const totalQuestions = rows.length;
  const stats: ChannelStat[] = [...groups.entries()].map(([source, rs]) => {
    const answered = rs.filter((r) => r.route === "answered").length;
    const handoff = rs.filter((r) => r.route === "handoff").length;
    const camp = new Map<string, { q: number; s: Set<string> }>();
    for (const r of rs) {
      if (!r.source_detail) continue;
      const c = camp.get(r.source_detail) ?? { q: 0, s: new Set<string>() };
      c.q++;
      c.s.add(r.session_id);
      camp.set(r.source_detail, c);
    }
    return {
      source,
      sessions: new Set(rs.map((r) => r.session_id)).size,
      questions: rs.length,
      answered,
      handoff,
      complaint: rs.filter((r) => r.route === "complaint").length,
      successRate: answered + handoff > 0 ? answered / (answered + handoff) : null,
      share: totalQuestions ? rs.length / totalQuestions : 0,
      campaigns: [...camp.entries()].map(([name, c]) => ({ name, questions: c.q, sessions: c.s.size })).sort((a, b) => b.questions - a.questions || a.name.localeCompare(b.name)),
    };
  });
  return { stats, total: { sessions: new Set(rows.map((r) => r.session_id)).size, questions: totalQuestions } };
}
