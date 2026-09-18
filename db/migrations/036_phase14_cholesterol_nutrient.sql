-- Phase 14: add dietary cholesterol as a new secondary nutrient, tracked the
-- same way saturated fat and omega-3 already are - a target range on
-- user_target_profiles, plus a running total on user_daily_reports and
-- user_default_items.

alter table public.user_target_profiles
  add column if not exists cholesterol_min_mg numeric(8,2) not null default 0,
  add column if not exists cholesterol_max_mg numeric(8,2) not null default 300;

alter table public.user_daily_reports
  add column if not exists cholesterol_mg numeric(8,2) not null default 0;

alter table public.user_default_items
  add column if not exists cholesterol_mg numeric(8,2) not null default 0;
