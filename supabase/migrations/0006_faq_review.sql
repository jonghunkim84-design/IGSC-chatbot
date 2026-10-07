-- 0006: 초안 검수·개정 대응(Phase 11)
--
-- 1) faq 컬럼 추가
--      review_reason      재검토가 필요한 이유: 'revised'(출처 문서가 개정됨) | 'deleted'(출처 문서가 삭제됨)
--      review_note        화면에 보여줄 설명 (예: "개정: 절차서.pdf (v1) → 절차서 개정.pdf (v2)")
--      review_flagged_at  재검토 표시가 붙은 시각
--      draft_note         자동 초안을 만든 결과 메모 (근거를 못 찾은 사유, 검증 탈락 사유 등)
--    needs_review 는 0003 에서 이미 만들었다.
--
-- 2) 출처 문서가 개정(archived)되거나 삭제되면, 그 문서를 출처로 가진 '승인된' FAQ 에 재검토 표시를 붙이는 트리거.
--      - status 는 건드리지 않는다: approved 는 그대로 유지되어 챗봇 답변이 끊기지 않는다.
--      - 코드가 아니라 DB 트리거로 처리하므로, 어떤 경로로 문서가 바뀌어도 표시가 빠지지 않는다.
--      - 삭제 시에는 FK(on delete set null)로 faq.source_doc_id 가 비워지기 전에 표시와 파일명을 남긴다.
--
-- 임베딩(벡터) 컬럼은 만들지 않는다. 여러 번 실행해도 안전하다.

alter table public.faq
  add column if not exists review_reason     text,
  add column if not exists review_note       text,
  add column if not exists review_flagged_at timestamptz,
  add column if not exists draft_note        text;

alter table public.faq drop constraint if exists faq_review_reason_check;
alter table public.faq add constraint faq_review_reason_check
  check (review_reason is null or review_reason in ('revised', 'deleted'));

-- ─────────────────────────────────────────────────────────────
-- 문서가 개정되어 archived 가 되면
-- ─────────────────────────────────────────────────────────────
create or replace function public.flag_faq_on_doc_archived()
returns trigger
language plpgsql
as $$
declare
  v_new_name text;
  v_new_ver  int;
begin
  select file_name, version into v_new_name, v_new_ver
    from public.documents
   where supersedes = new.id
   order by version desc
   limit 1;

  update public.faq
     set needs_review     = true,
         review_reason    = 'revised',
         review_flagged_at = now(),
         review_note      = format('개정: %s (v%s)', new.file_name, new.version)
                            || case when v_new_name is not null then format(' → %s (v%s)', v_new_name, v_new_ver) else '' end
   where source_doc_id = new.id
     and status = 'approved'
     and needs_review = false;      -- 이미 표시된 FAQ 는 처음 표시(사유·시각)를 유지
  return new;
end $$;

drop trigger if exists documents_flag_faq_on_archive on public.documents;
create trigger documents_flag_faq_on_archive
  after update of status on public.documents
  for each row
  when (new.status = 'archived' and old.status is distinct from 'archived')
  execute function public.flag_faq_on_doc_archived();

-- ─────────────────────────────────────────────────────────────
-- 문서가 삭제되면 (삭제 전에 표시: FK 가 source_doc_id 를 null 로 만들기 전)
-- ─────────────────────────────────────────────────────────────
create or replace function public.flag_faq_on_doc_deleted()
returns trigger
language plpgsql
as $$
begin
  update public.faq
     set needs_review      = true,
         review_reason     = 'deleted',
         review_flagged_at = now(),
         review_note       = format('삭제된 문서: %s (v%s)', old.file_name, old.version)
   where source_doc_id = old.id
     and status = 'approved';       -- 개정으로 이미 표시되었더라도, 출처가 사라진 것이 더 중대하므로 사유를 덮어쓴다
  return old;
end $$;

drop trigger if exists documents_flag_faq_on_delete on public.documents;
create trigger documents_flag_faq_on_delete
  before delete on public.documents
  for each row
  execute function public.flag_faq_on_doc_deleted();

-- 트리거 전용 함수라 직접 호출할 필요가 없다
revoke execute on function public.flag_faq_on_doc_archived() from public, anon, authenticated;
revoke execute on function public.flag_faq_on_doc_deleted()  from public, anon, authenticated;

-- 실행 후 확인 (선택)
-- select column_name from information_schema.columns where table_schema='public' and table_name='faq'
--   and column_name in ('needs_review','review_reason','review_note','review_flagged_at','draft_note');    -- 5행
-- select tgname from pg_trigger where tgname in ('documents_flag_faq_on_archive','documents_flag_faq_on_delete');  -- 2행
