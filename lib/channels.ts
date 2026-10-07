/**
 * 유입 채널 (챗봇 링크를 걸어 둔 곳). 서버·브라우저 양쪽에서 쓰는 순수 함수만 둔다.
 *
 * 링크 형식:  {챗봇 주소}/chat?src={채널 코드}&c={캠페인 이름(선택)}
 *   예) /chat?src=instagram            인스타그램 프로필 링크
 *       /chat?src=email-signature&c=kim  김 팀장 이메일 서명
 * 채널을 늘리려면 CHANNELS 에 한 줄 추가한다. (캠페인 이름 c 는 코드 수정 없이 자유롭게 쓸 수 있다.)
 */

export interface Channel {
  code: string;
  label: string;
  hint: string;
}

export const CHANNELS: Channel[] = [
  { code: "homepage", label: "홈페이지", hint: "홈페이지의 챗봇 버튼(위젯)과 홈페이지 안의 링크" },
  { code: "naver-blog", label: "네이버 블로그", hint: "블로그 글·프로필의 챗봇 링크" },
  { code: "linkedin", label: "링크드인", hint: "링크드인 게시물·프로필의 챗봇 링크" },
  { code: "instagram", label: "인스타그램", hint: "인스타그램 프로필(링크) 또는 스토리 링크" },
  { code: "email-signature", label: "직원 이메일 서명", hint: "직원 이메일 서명 하단의 챗봇 링크" },
];

/** 링크에 채널 표시가 없거나 알 수 없을 때 */
export const SOURCE_DIRECT = "direct";
/** 목록에 없는 채널 코드로 들어온 경우 (src 값은 source_detail 에 남긴다) */
export const SOURCE_OTHER = "other";

const LABELS = new Map(CHANNELS.map((c) => [c.code, c.label]));

export function channelLabel(source: string | null | undefined): string {
  if (!source || source === SOURCE_DIRECT) return "직접 입력·알 수 없음";
  if (source === SOURCE_OTHER) return "기타";
  return LABELS.get(source) ?? `기타(${source})`;
}

const DETAIL_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** 캠페인 이름: 소문자 영문·숫자·_- 40자 이내. 맞지 않으면 버린다 (저장값을 신뢰하지 않기 위함). */
export function sanitizeDetail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return DETAIL_RE.test(v) ? v : null;
}

export interface NormalizedSource {
  source: string | null;
  source_detail: string | null;
}

/**
 * 클라이언트가 보낸 값을 저장 가능한 값으로 정리한다.
 * - 알려진 채널 코드면 그대로, 형식은 맞지만 모르는 코드면 source='other' + detail=원래 코드
 * - 없거나 형식이 이상하면 null (집계에서 '직접 입력·알 수 없음')
 */
export function normalizeSource(src: unknown, detail?: unknown): NormalizedSource {
  const s = typeof src === "string" ? src.trim().toLowerCase() : "";
  const d = sanitizeDetail(detail);
  if (!s) return { source: null, source_detail: d };
  if (LABELS.has(s)) return { source: s, source_detail: d };
  const raw = sanitizeDetail(s);
  if (raw) return { source: SOURCE_OTHER, source_detail: d ?? raw };
  return { source: null, source_detail: d };
}

/** 링크에 src 가 없을 때 이전 페이지(Referer) 주소로 채널을 짐작한다. 브라우저가 Referer 를 주지 않으면 짐작하지 못한다. */
export function inferFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  let host = "";
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  const is = (d: string) => host === d || host.endsWith(`.${d}`);
  if (is("blog.naver.com") || is("m.blog.naver.com")) return "naver-blog";
  if (is("linkedin.com") || is("lnkd.in")) return "linkedin";
  if (is("instagram.com")) return "instagram";
  return null;
}

/** 챗봇 주소 뒤의 쿼리(`?src=…&c=…`)와 Referer 로 이 방문의 채널을 정한다. 링크의 src 가 우선이다. */
export function resolveClientSource(search: string, referrer?: string | null): NormalizedSource | null {
  const p = new URLSearchParams(search);
  const src = p.get("src") ?? p.get("utm_source");
  const detail = p.get("c") ?? p.get("utm_campaign");
  if (src) {
    const n = normalizeSource(src, detail);
    if (n.source) return n;
  }
  const inferred = inferFromReferrer(referrer);
  if (inferred) return { source: inferred, source_detail: sanitizeDetail(detail) };
  return null;
}

/** 채널별 공유 링크 */
export function buildChannelLink(origin: string, code: string, campaign?: string | null): string {
  const base = origin.replace(/\/+$/, "");
  const c = sanitizeDetail(campaign);
  return `${base}/chat?src=${encodeURIComponent(code)}${c ? `&c=${encodeURIComponent(c)}` : ""}`;
}
