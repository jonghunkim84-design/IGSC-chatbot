-- 0010: Phase 12~14 추가 결정 반영
--
-- 1) 작업 테이블 이름·열 이름을 지시서에 맞춘다: doc_faq_jobs → generation_jobs
--      next_chunk → done_chunks (이미 처리한 청크 수. 중단되면 여기서부터 이어서 한다), created_at → started_at
--      limit_reached 추가: 파일당 상한(50건)에 도달해 중단된 작업 표시 / lock_until 추가: 동시에 같은 구간을 처리하지 않게 하는 90초 잠금
--    status 는 running | done | failed 에 더해 canceled(같은 문서를 다시 시작하면서 이전 작업을 대체)를 쓴다.
-- 2) documents: content_hash(중복 업로드 차단), doc_format(narrative | qa_pairs), format_confirmed(Q&A 형식 확인),
--      extracted_chars / page_count(추출 품질 지표)
-- 3) faq: approved_by, approved_at (누가 언제 승인했는지)
-- 여러 번 실행해도 안전하다. 먼저 0007 이 실행되어 있어야 한다 (이미 이름이 바뀌어 있어도 건너뛴다).

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_faq_jobs')
     and not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'generation_jobs') then
    alter table public.doc_faq_jobs rename to generation_jobs;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'generation_jobs' and column_name = 'next_chunk') then
    alter table public.generation_jobs rename column next_chunk to done_chunks;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'generation_jobs' and column_name = 'created_at') then
    alter table public.generation_jobs rename column created_at to started_at;
  end if;
end $$;

alter table public.generation_jobs add column if not exists limit_reached boolean not null default false;
-- 한 번에 한 요청만 같은 청크 범위를 처리하게 하는 짧은 잠금 (요청이 중간에 끊기면 만료되어 done_chunks 부터 다시 처리된다)
alter table public.generation_jobs add column if not exists lock_until timestamptz;
alter index if exists public.doc_faq_jobs_doc_idx rename to generation_jobs_doc_idx;

-- documents
alter table public.documents
  add column if not exists content_hash     text,
  add column if not exists doc_format       text not null default 'narrative',
  add column if not exists format_confirmed boolean not null default true,
  add column if not exists extracted_chars  int,
  add column if not exists page_count       int;

alter table public.documents drop constraint if exists documents_doc_format_check;
alter table public.documents add constraint documents_doc_format_check check (doc_format in ('narrative', 'qa_pairs'));
create index if not exists documents_content_hash_idx on public.documents (content_hash) where content_hash is not null;

-- faq: 승인자 기록
alter table public.faq
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

-- 확인 (실행 후)
-- select column_name from information_schema.columns where table_schema='public' and table_name='generation_jobs' order by ordinal_position;
-- select column_name from information_schema.columns where table_schema='public' and table_name='documents' and column_name in ('content_hash','doc_format','format_confirmed','extracted_chars','page_count');  -- 5행
-- select column_name from information_schema.columns where table_schema='public' and table_name='faq' and column_name in ('approved_by','approved_at');  -- 2행
