-- Phase 17: preserves what the user actually typed for a custom target
-- (e.g. "3000" for a step-count goal) alongside the value converted into
-- that target's own canonical unit, whenever the two don't match.
--
-- custom_target_values (existing, migration 027) always holds the
-- canonical value - the one aggregation/rings compare against target_min/
-- target_max, in the target's own stored unit. custom_target_value_originals
-- holds, per target id, the raw {value, unit} exactly as the user entered
-- it, ONLY for entries where a unit mismatch was detected and reconciled
-- (see reconcileCustomTargetValueUnits in lib/ai/daily-report.ts) - an
-- entry that already matched its target's unit has nothing to record here.

alter table if exists public.user_daily_reports
  add column if not exists custom_target_value_originals jsonb not null default '{}'::jsonb;
