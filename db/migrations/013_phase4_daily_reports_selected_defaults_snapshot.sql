-- Phase 4 daily reports: persist selected defaults snapshot so AI retry can reapply defaults.

alter table if exists public.user_daily_reports
  add column if not exists selected_defaults jsonb not null default '[]'::jsonb;
