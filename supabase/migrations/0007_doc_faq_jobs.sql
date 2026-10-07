-- 0007: 문서 단위 FAQ 일괄 초안 생성(Phase 12) — 작업 상태·탈락 목록 보관
--
-- 문서 하나에서 FAQ 초안을 여러 건 만드는 작업은 청크 수에 따라 오래 걸려 한 번의 요청(60초)에 끝나지 않는다.
-- 화면이 청크를 나눠 여러 번 호출하며 진행하고, 진행 위치와 탈락 항목은 이 테이블에 남긴다.
--   - 새로고침·재접속해도 탈락 목록(사유·원문 일부)을 다시 볼 수 있다.
--   - 화면을 닫아 중단된 작업은 next_chunk 부터 이어서 실행할 수 있다.
-- 임베딩(벡터) 컬럼은 만들지 않는다. 여러 번 실행해도 안전하다.

create table if not exists public.doc_faq_jobs (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  status          text not null default 'running' check (status in ('running', 'done', 'failed', 'canceled')),
  total_chunks    int  not null default 0,
  next_chunk      int  not null default 0,          -- 다음에 처리할 청크 순번 (0부터). total_chunks 이상이면 끝
  created_count   int  not null default 0,          -- 만들어진 초안 수
  replaced_count  int  not null default 0,          -- 재실행으로 교체(삭제)한 이전 자동 초안 수
  protected_count int  not null default 0,          -- 수정되었거나 미답변에서 만든 초안이라 지우지 않은 수
  rejected        jsonb not null default '[]'::jsonb, -- [{ page, content, reason, stage }]
  error           text,
  started_by      text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists doc_faq_jobs_doc_idx on public.doc_faq_jobs (document_id, created_at desc);

-- 서버(service role) 전용: 정책이 없으므로 익명·로그인 사용자는 접근할 수 없다.
alter table public.doc_faq_jobs enable row level security;

-- 확인 (실행 후)
-- select column_name from information_schema.columns where table_schema='public' and table_name='doc_faq_jobs'; -- 14행
