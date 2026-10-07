-- 0008: 문서 단위 검수 큐(Phase 13) — 보류 표시
--
-- 검수 큐에서 [보류]한 초안은 status='draft' 로 그대로 두고, 목록에서 흐리게 보이도록 표시만 한다.
-- 여러 담당자가 같은 보류 상태를 보고, 문서 목록의 '미검수' 건수에서 보류를 따로 셀 수 있게 DB에 둔다.
-- 승인(approved)되면 코드가 review_hold 를 false 로 되돌린다.
-- 익명 사용자에게는 이 컬럼을 열어주지 않는다 (0003 에서 컬럼 단위로 권한을 준 구조 그대로). 여러 번 실행해도 안전하다.

alter table public.faq
  add column if not exists review_hold boolean not null default false;

create index if not exists faq_review_hold_idx on public.faq (source_doc_id) where review_hold;

-- 확인 (실행 후)
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema='public' and table_name='faq' and column_name='review_hold';   -- 1행
