-- 0005: 텍스트 추출(Phase 9) — doc_chunks 를 명세에 맞추고, 추출 결과를 한 번에(트랜잭션) 반영하는 함수를 만든다.
--
-- 변경 요약
--   doc_chunks.page    → page_no         (PDF 는 페이지, PPTX 는 슬라이드, 그 외 null)
--   doc_chunks.heading → section_title
--   documents.failure_reason  추가: status='failed' 일 때 화면에 보여줄 사유
--   documents.chunk_count     추가 (명세에 없던 컬럼): 목록에 "조각 N개"를 빠르게 보이기 위한 값
--   함수 finish_doc_extraction / fail_doc_extraction: 기존 조각 삭제 → 새 조각 저장 → 상태 갱신을 한 트랜잭션으로
--     (같은 문서를 동시에 다시 추출해도 문서 행을 잠가서 조각이 중복되지 않는다)
--
-- 임베딩(벡터) 컬럼은 만들지 않는다.
-- 안전장치: doc_chunks 에 행이 있으면 컬럼 이름을 바꾸지 않고 중단한다.

do $$
begin
  if exists (select 1 from public.doc_chunks) then
    raise exception 'doc_chunks 에 데이터가 있어 0005 를 실행하지 않습니다. 먼저 내용을 확인하세요.';
  end if;
end $$;

-- 1. doc_chunks 컬럼 이름 (이미 바뀐 상태에서 다시 실행해도 오류가 나지 않게 검사)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='doc_chunks' and column_name='page') then
    alter table public.doc_chunks rename column page to page_no;
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='doc_chunks' and column_name='heading') then
    alter table public.doc_chunks rename column heading to section_title;
  end if;
end $$;

-- 2. documents 컬럼 추가
alter table public.documents
  add column if not exists failure_reason text,
  add column if not exists chunk_count    int not null default 0;

-- 3. 추출 성공: 조각 교체 + 상태 갱신 (한 트랜잭션)
create or replace function public.finish_doc_extraction(p_document_id uuid, p_chunks jsonb)
returns int
language plpgsql
as $$
declare
  v_status text;
  v_count  int;
begin
  select status into v_status from public.documents where id = p_document_id for update;   -- 동시 추출 직렬화
  if not found then
    raise exception 'document not found: %', p_document_id;
  end if;
  if v_status = 'archived' then
    raise exception 'archived document: %', p_document_id;
  end if;

  delete from public.doc_chunks where document_id = p_document_id;

  insert into public.doc_chunks (document_id, chunk_index, content, page_no, section_title)
  select p_document_id,
         (c->>'chunk_index')::int,
         c->>'content',
         nullif(c->>'page_no', '')::int,
         nullif(c->>'section_title', '')
  from jsonb_array_elements(p_chunks) as c;
  get diagnostics v_count = row_count;

  update public.documents
     set status = 'extracted', extracted_at = now(), failure_reason = null, chunk_count = v_count
   where id = p_document_id;
  return v_count;
end $$;

-- 4. 추출 실패: 조각 삭제 + failed 와 사유 기록
create or replace function public.fail_doc_extraction(p_document_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.documents where id = p_document_id for update;
  if not found or v_status = 'archived' then
    return;     -- 없는 문서/이전 버전(archived)은 상태를 바꾸지 않는다
  end if;
  delete from public.doc_chunks where document_id = p_document_id;
  update public.documents
     set status = 'failed', extracted_at = null, failure_reason = p_reason, chunk_count = 0
   where id = p_document_id;
end $$;

-- 5. 서버(service role)만 호출할 수 있게 (기본으로 열려 있는 실행 권한 회수)
revoke execute on function public.finish_doc_extraction(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_doc_extraction(uuid, text)     from public, anon, authenticated;
grant  execute on function public.finish_doc_extraction(uuid, jsonb) to service_role;
grant  execute on function public.fail_doc_extraction(uuid, text)     to service_role;

-- 실행 후 확인 (선택)
-- select column_name from information_schema.columns where table_schema='public' and table_name='doc_chunks' order by ordinal_position;
-- select column_name from information_schema.columns where table_schema='public' and table_name='documents' and column_name in ('failure_reason','chunk_count');
-- select proname from pg_proc where proname in ('finish_doc_extraction','fail_doc_extraction');
