-- 0004: documents 테이블을 Phase 8 명세에 맞춘다 (0003 에서 만든 초기 설계를 대체).
--
-- 변경 요약
--   컬럼 이름 변경 : original_filename → file_name, size_bytes → file_size, replaces_document_id → supersedes
--   컬럼 추가     : doc_category, version, extracted_at
--   컬럼 삭제     : title, version_label, effective_date, page_count, parse_status, parse_error, note
--   상태값 변경   : active/superseded/archived → pending/extracted/failed/archived (기본 pending)
--   cert_type     : 기본값 'common'
--   버킷          : 허용 형식에 xlsx, csv, pptx 추가
--
-- 안전장치: documents 에 행이 하나라도 있으면 아무것도 바꾸지 않고 중단한다 (삭제되는 컬럼의 데이터 보호).
-- faq.source_doc_id, doc_chunks.document_id 의 외래키는 그대로 유지된다.

do $$
begin
  if exists (select 1 from public.documents) then
    raise exception 'documents 에 데이터가 있어 0004 를 실행하지 않습니다. 먼저 내용을 확인하세요.';
  end if;
end $$;

-- 1. 컬럼 이름 변경
alter table public.documents rename column original_filename    to file_name;
alter table public.documents rename column size_bytes           to file_size;
alter table public.documents rename column replaces_document_id to supersedes;

-- 2. 컬럼 삭제 (0003 의 초기 설계 중 명세에 없는 것)
alter table public.documents
  drop column if exists title,
  drop column if exists version_label,
  drop column if exists effective_date,
  drop column if exists page_count,
  drop column if exists parse_status,
  drop column if exists parse_error,
  drop column if exists note;

-- 3. 컬럼 추가·변경
alter table public.documents alter column file_size type int;   -- 파일당 20MB 이하라 int 로 충분

alter table public.documents
  add column if not exists doc_category text not null default 'other',
  add column if not exists version      int  not null default 1,
  add column if not exists extracted_at timestamptz;

alter table public.documents drop constraint if exists documents_doc_category_check;
alter table public.documents add constraint documents_doc_category_check
  check (doc_category in ('procedure', 'fee', 'form', 'policy', 'other'));

alter table public.documents drop constraint if exists documents_version_check;
alter table public.documents add constraint documents_version_check check (version >= 1);

alter table public.documents alter column cert_type set default 'common';

-- 상태: pending(추출 대기) | extracted | failed | archived(이전 버전)
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents alter column status set default 'pending';
alter table public.documents add constraint documents_status_check
  check (status in ('pending', 'extracted', 'failed', 'archived'));

create index if not exists documents_supersedes_idx on public.documents (supersedes) where supersedes is not null;

-- 4. Storage 버킷 'documents': 허용 형식 확장 (비공개·20MB·정책 없음 = 서버 전용은 그대로)
update storage.buckets
   set public = false,
       file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     -- .docx
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           -- .xlsx
         'application/vnd.openxmlformats-officedocument.presentationml.presentation',   -- .pptx
         'text/csv',
         'text/plain',
         'text/markdown'
       ]
 where id = 'documents';

-- 실행 후 확인 (선택)
-- select column_name, data_type, column_default from information_schema.columns
--   where table_schema='public' and table_name='documents' order by ordinal_position;
-- select allowed_mime_types from storage.buckets where id='documents';
