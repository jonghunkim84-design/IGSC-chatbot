-- IGSC 고객 Q&A 스키마. 벡터 임베딩(pgvector/embedding 컬럼/벡터 인덱스)은 사용하지 않는다.

create table public.faq (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  variants    text[] not null default '{}',
  answer      text not null,
  cert_type   text not null,
  category    text not null check (category in ('procedure','cost','duration','document','scope','renewal')),
  source_url  text,
  lang        text not null default 'ko',
  status      text not null default 'draft' check (status in ('draft','approved')),
  needs_input boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index faq_cert_type_status_idx on public.faq (cert_type, status);

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger faq_set_updated_at
  before update on public.faq
  for each row execute function public.set_updated_at();

create table public.cert_history (
  id               uuid primary key default gen_random_uuid(),
  cert_type        text not null,
  product_category text,
  company_public   boolean not null default false,
  company_name     text,
  year             int
);

create table public.chat_log (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null,
  question        text not null,
  answer          text,
  matched_faq_ids uuid[] not null default '{}',
  route           text not null check (route in ('answered','consulting_blocked','handoff','complaint')),
  created_at      timestamptz not null default now()
);

create table public.unanswered (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  chat_log_id uuid references public.chat_log (id) on delete set null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- RLS: 익명은 승인된 FAQ 읽기만. 나머지 테이블은 정책이 없으므로 anon/authenticated 접근 불가
-- (service role은 RLS를 우회).
alter table public.faq          enable row level security;
alter table public.cert_history enable row level security;
alter table public.chat_log     enable row level security;
alter table public.unanswered   enable row level security;

create policy "anon can read approved faq"
  on public.faq for select
  to anon, authenticated
  using (status = 'approved');
