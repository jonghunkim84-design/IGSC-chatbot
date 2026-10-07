-- 0003: 문서 기반 FAQ 초안 작성 기능
--
-- 업로드한 인증·검증 문서를 FAQ 초안의 "재료"로 쓰기 위한 스키마.
-- 원칙: 문서는 고객 답변의 근거가 아니다. 챗봇은 이 테이블들을 읽지 않으며,
--       고객에게 나가는 답변은 승인된 FAQ(faq.status = 'approved')에만 근거한다.
-- 벡터 임베딩(pgvector / embedding 컬럼 / 벡터 인덱스)은 사용하지 않는다.
-- 여러 번 실행해도 안전하다 (if not exists / on conflict).

-- ─────────────────────────────────────────────────────────────
-- 1. documents: 업로드된 문서 (파일 자체는 Storage 버킷 'documents')
-- ─────────────────────────────────────────────────────────────
create table if not exists public.documents (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  cert_type            text not null,                       -- lib/cert-names.ts 의 slug ('common' 포함)
  version_label        text,                                -- 예: 'v2.1', '2026-03 개정'
  effective_date       date,                                -- 시행일
  status               text not null default 'active'
                         check (status in ('active', 'superseded', 'archived')),
  replaces_document_id uuid references public.documents (id) on delete set null,  -- 개정본이 대체하는 이전 문서
  storage_path         text not null unique,                -- 버킷 'documents' 안의 경로
  original_filename    text not null,
  mime_type            text not null,
  size_bytes           bigint not null check (size_bytes >= 0),
  page_count           int,
  parse_status         text not null default 'pending'
                         check (parse_status in ('pending', 'processing', 'done', 'failed')),
  parse_error          text,
  uploaded_by          text not null,                       -- 업로드한 관리자 이메일
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists documents_cert_status_idx on public.documents (cert_type, status);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. doc_chunks: 문서에서 추출한 텍스트 조각 (페이지 단위 근거 표시용)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.doc_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  chunk_index  int  not null,
  page         int,                                          -- 원문 페이지 (없으면 null)
  heading      text,                                         -- 조각이 속한 제목/절 (있으면)
  content      text not null,
  created_at   timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists doc_chunks_doc_page_idx on public.doc_chunks (document_id, page);

-- ─────────────────────────────────────────────────────────────
-- 3. faq 컬럼 추가
-- ─────────────────────────────────────────────────────────────
alter table public.faq
  add column if not exists source_doc_id uuid references public.documents (id) on delete set null,  -- 초안의 근거 문서
  add column if not exists source_page   int,                                                      -- 근거 페이지
  add column if not exists needs_review  boolean not null default false;                           -- 근거 문서가 개정되어 재검토 필요

-- 【추가 제안 — 지시서에 없던 컬럼 2개. 원치 않으면 아래 alter 문 전체를 지우고 실행하세요】
--   source_evidence      : 문서 원문에서 그대로 인용한 근거 문장. 수정 화면의 "evidence 강조"를 위해 필요
--   source_unanswered_id : 이 초안을 만든 미답변 질문. "초안 만들기 → 검수하기" 버튼 상태 판단용
--                          (unanswered 테이블 구조는 바꾸지 않고, faq 쪽에서 참조만 한다)
alter table public.faq
  add column if not exists source_evidence      text[] not null default '{}',
  add column if not exists source_unanswered_id uuid references public.unanswered (id) on delete set null;

create index if not exists faq_source_doc_idx    on public.faq (source_doc_id) where source_doc_id is not null;
create index if not exists faq_needs_review_idx  on public.faq (needs_review) where needs_review;
create index if not exists faq_source_unanswered_idx on public.faq (source_unanswered_id) where source_unanswered_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────
-- 새 테이블은 서버(service role) 전용: RLS 를 켜고 정책을 만들지 않는다.
alter table public.documents  enable row level security;
alter table public.doc_chunks enable row level security;

-- faq 는 익명에게 '승인된 행'을 읽게 하는 기존 정책이 있다. 새 컬럼(문서 id, 페이지, 근거 원문 등)은
-- 내부 문서에서 나온 정보라서 익명/일반 로그인 사용자에게 노출되지 않도록 컬럼 단위로 권한을 좁힌다.
-- (챗봇·관리자 화면은 service role 로 읽으므로 영향 없음. 익명 키로 select=* 를 하면 권한 오류가 난다 —
--  이 프로젝트에는 익명 키로 faq 를 읽는 코드가 없다.)
revoke select on public.faq from anon, authenticated;
grant select (id, question, variants, answer, cert_type, category, source_url, lang, status, needs_input, created_at, updated_at)
  on public.faq to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Storage 버킷 'documents' (비공개)
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,                                   -- 비공개: URL 로 직접 접근 불가
  20971520,                                -- 파일당 20MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   -- .docx
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects 에는 이 버킷에 대한 정책을 일부러 만들지 않는다.
-- RLS 가 켜져 있고 정책이 없으므로 익명/로그인 사용자는 이 버킷의 파일을 읽거나 쓸 수 없고,
-- 서버(service role)만 업로드·다운로드할 수 있다. (브라우저 업로드는 서버가 발급한 서명 URL 로만 가능)

-- ─────────────────────────────────────────────────────────────
-- 실행 후 확인 (선택): 아래를 각각 실행해 결과를 확인하세요
-- ─────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='faq' and column_name in
--   ('source_doc_id','source_page','needs_review','source_evidence','source_unanswered_id');   -- 5행
-- select id, public, file_size_limit from storage.buckets where id='documents';                 -- public = false
-- select policyname from pg_policies where schemaname='storage' and tablename='objects'
--   and (qual ilike '%documents%' or with_check ilike '%documents%');                           -- 0행이어야 함
-- select extname from pg_extension where extname in ('vector','pg_trgm');                       -- vector 는 기존 그대로, 이 파일이 추가한 확장 없음
