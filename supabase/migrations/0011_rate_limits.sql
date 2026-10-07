-- 요청 제한(rate limit): 고정 구간 카운터. 서버(service role)에서만 RPC 로 호출한다.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;  -- 정책 없음: anon/authenticated 접근 불가

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, current_count integer, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_count integer;
begin
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limits as r (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  -- 오래된 구간 정리 (가끔만)
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '2 days';
  end if;
  allowed := v_count <= p_limit;
  current_count := v_count;
  retry_after := greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::integer);
  return next;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
revoke all on table public.rate_limits from anon, authenticated;
