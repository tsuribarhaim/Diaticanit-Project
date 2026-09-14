-- Phase 9 (Custom target tracking): "{Name}'s Targets" entries from the
-- Targets chat currently store just a free-text label/value pair with no
-- connection to anything the user logs. This adds one generic, additive
-- column so daily reports can log a value against whichever custom targets
-- are currently active, whatever they turn out to be (sleep hours, step
-- count, etc.) - no per-metric hardcoding needed. The user_targets JSONB
-- column on user_target_profiles needs no schema change; only the shape of
-- new entries written into it changes (adding id/unit/target_min/target_max
-- alongside the existing label/value), which JSONB accommodates without a
-- migration.

alter table public.user_daily_reports
  add column if not exists custom_target_values jsonb not null default '{}'::jsonb;
