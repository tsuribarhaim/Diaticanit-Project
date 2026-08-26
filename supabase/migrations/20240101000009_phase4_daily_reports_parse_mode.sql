-- Phase 4 daily reports: persist parser route metadata for heuristic/AI mode.

alter table if exists public.user_daily_reports
  add column if not exists parse_mode text not null default 'heuristic'
    check (parse_mode in ('heuristic', 'ai'));

alter table if exists public.user_daily_reports
  add column if not exists parser_version text not null default 'daily-heuristic-v1';

update public.user_daily_reports
set parse_mode = 'heuristic'
where parse_mode is null;

update public.user_daily_reports
set parser_version = 'daily-heuristic-v1'
where parser_version is null or btrim(parser_version) = '';
