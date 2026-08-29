-- Phase 7 (Daily Report redesign, Phase 2): per-user preference for which
-- extra metrics show as progress rings/trend charts on the Daily Report
-- dashboard, beyond the 5 always-visible defaults.

alter table public.user_profile
  add column if not exists daily_report_chart_preferences jsonb not null default '{}'::jsonb;
