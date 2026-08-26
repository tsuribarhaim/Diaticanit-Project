-- Phase 4 daily reports: optional reported body weight for trend and plan-vs-actual views.

alter table if exists public.user_daily_reports
  add column if not exists reported_weight_kg numeric(6,2)
    check (reported_weight_kg is null or (reported_weight_kg >= 20 and reported_weight_kg <= 400));

create index if not exists idx_user_daily_reports_user_goal_report_at
  on public.user_daily_reports(user_id, goal_id, report_at desc);
