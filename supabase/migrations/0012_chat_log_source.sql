-- 0012: 유입 채널 기록 — chat_log 에 채널(source)과 캠페인(source_detail)을 남긴다.
-- source: homepage / naver-blog / linkedin / instagram / email-signature / other / null(직접·알 수 없음)
-- source_detail: 캠페인 이름(소문자 영문·숫자·_- 40자 이내) 또는 other 인 경우 원래 코드
-- 값 검증은 코드(lib/channels.ts)에서 하므로 제약은 길이만 둔다. 기존 행은 null 로 남는다(= 직접·알 수 없음).
alter table public.chat_log
  add column if not exists source text check (source is null or char_length(source) <= 40),
  add column if not exists source_detail text check (source_detail is null or char_length(source_detail) <= 40);

create index if not exists chat_log_source_created_idx on public.chat_log (source, created_at desc);
