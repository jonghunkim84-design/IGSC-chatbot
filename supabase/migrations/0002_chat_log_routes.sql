-- chat_log.route 확장: out_of_scope(인증과 무관한 질문), clarify(인증 종류 되묻기)
alter table public.chat_log drop constraint if exists chat_log_route_check;
alter table public.chat_log
  add constraint chat_log_route_check
  check (route in ('answered','consulting_blocked','handoff','complaint','out_of_scope','clarify'));
