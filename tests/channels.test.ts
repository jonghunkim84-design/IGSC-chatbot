/** 유입 채널: 값 정리, Referer 추정, 링크 만들기, 채널별 집계 */
import { describe, expect, it } from "vitest";
import { CHANNELS, buildChannelLink, channelLabel, inferFromReferrer, normalizeSource, resolveClientSource, sanitizeDetail } from "@/lib/channels";
import { aggregateChannels, type ChannelRow } from "@/lib/admin/channel-stats";

describe("normalizeSource", () => {
  it("등록된 채널은 그대로", () => {
    expect(normalizeSource("instagram")).toEqual({ source: "instagram", source_detail: null });
    expect(normalizeSource(" Naver-Blog ", "Story-1010")).toEqual({ source: "naver-blog", source_detail: "story-1010" });
  });
  it("모르는 코드는 other + 원래 코드", () => {
    expect(normalizeSource("kakao")).toEqual({ source: "other", source_detail: "kakao" });
  });
  it("없거나 이상한 값은 null (저장하지 않음)", () => {
    expect(normalizeSource(undefined)).toEqual({ source: null, source_detail: null });
    expect(normalizeSource("")).toEqual({ source: null, source_detail: null });
    expect(normalizeSource("<script>alert(1)</script>")).toEqual({ source: null, source_detail: null });
    expect(normalizeSource("x".repeat(80))).toEqual({ source: null, source_detail: null });
    expect(normalizeSource("linkedin", "한글 캠페인!")).toEqual({ source: "linkedin", source_detail: null });
  });
  it("sanitizeDetail: 소문자 영문·숫자·-_ 40자", () => {
    expect(sanitizeDetail("Kim_01")).toBe("kim_01");
    expect(sanitizeDetail("a b")).toBeNull();
    expect(sanitizeDetail("a".repeat(41))).toBeNull();
    expect(sanitizeDetail(123)).toBeNull();
  });
});

describe("inferFromReferrer / resolveClientSource", () => {
  it("이전 페이지 주소로 채널 짐작", () => {
    expect(inferFromReferrer("https://blog.naver.com/igsc/223")).toBe("naver-blog");
    expect(inferFromReferrer("https://m.blog.naver.com/igsc")).toBe("naver-blog");
    expect(inferFromReferrer("https://www.linkedin.com/feed/")).toBe("linkedin");
    expect(inferFromReferrer("https://l.instagram.com/?u=x")).toBe("instagram");
    expect(inferFromReferrer("https://example.com/")).toBeNull();
    expect(inferFromReferrer("not a url")).toBeNull();
    expect(inferFromReferrer("")).toBeNull();
  });
  it("링크의 src 가 Referer 보다 우선", () => {
    expect(resolveClientSource("?src=email-signature&c=kim", "https://www.linkedin.com/")).toEqual({ source: "email-signature", source_detail: "kim" });
  });
  it("utm_source 도 받는다", () => {
    expect(resolveClientSource("?utm_source=instagram&utm_campaign=bio", null)).toEqual({ source: "instagram", source_detail: "bio" });
  });
  it("src 가 없으면 Referer, 둘 다 없으면 null", () => {
    expect(resolveClientSource("", "https://blog.naver.com/x")?.source).toBe("naver-blog");
    expect(resolveClientSource("?foo=1", "")).toBeNull();
  });
});

describe("buildChannelLink", () => {
  it("채널·캠페인 링크", () => {
    expect(buildChannelLink("https://chat.example.com/", "instagram")).toBe("https://chat.example.com/chat?src=instagram");
    expect(buildChannelLink("https://chat.example.com", "email-signature", "Kim")).toBe("https://chat.example.com/chat?src=email-signature&c=kim");
    expect(buildChannelLink("https://chat.example.com", "linkedin", "나쁜 이름")).toBe("https://chat.example.com/chat?src=linkedin");
  });
  it("라벨", () => {
    expect(channelLabel("naver-blog")).toBe("네이버 블로그");
    expect(channelLabel(null)).toBe("직접 입력·알 수 없음");
    expect(channelLabel("other")).toBe("기타");
    expect(CHANNELS.map((c) => c.label)).toEqual(["홈페이지", "네이버 블로그", "링크드인", "인스타그램", "직원 이메일 서명"]);
  });
});

describe("aggregateChannels", () => {
  const rows: ChannelRow[] = [
    { session_id: "a", route: "answered", source: "instagram", source_detail: "story" },
    { session_id: "a", route: "handoff", source: "instagram", source_detail: "story" },
    { session_id: "b", route: "answered", source: "instagram", source_detail: null },
    { session_id: "c", route: "complaint", source: "homepage", source_detail: null },
    { session_id: "d", route: "answered", source: null, source_detail: null },
    { session_id: "e", route: "answered", source: "other", source_detail: "kakao" },
  ];
  const { stats, total } = aggregateChannels(rows);
  const by = Object.fromEntries(stats.map((s) => [s.source, s]));

  it("질문·대화 수", () => {
    expect(total).toEqual({ questions: 6, sessions: 5 });
    expect(by.instagram.questions).toBe(3);
    expect(by.instagram.sessions).toBe(2);
    expect(by.homepage.complaint).toBe(1);
    expect(by.direct.questions).toBe(1);
  });
  it("답변 성공률 = 답변 완료 ÷ (답변 완료 + 담당자 이관)", () => {
    expect(by.instagram.successRate).toBeCloseTo(2 / 3);
    expect(by.homepage.successRate).toBeNull();
  });
  it("비중과 캠페인", () => {
    expect(by.instagram.share).toBeCloseTo(0.5);
    expect(by.instagram.campaigns).toEqual([{ name: "story", questions: 2, sessions: 1 }]);
    expect(by.other.campaigns[0].name).toBe("kakao");
  });
  it("질문이 없는 등록 채널도 0건으로 나오고 순서가 고정", () => {
    expect(stats.map((s) => s.source)).toEqual(["homepage", "naver-blog", "linkedin", "instagram", "email-signature", "other", "direct"]);
    expect(by["naver-blog"].questions).toBe(0);
    expect(aggregateChannels([]).total).toEqual({ questions: 0, sessions: 0 });
  });
});
