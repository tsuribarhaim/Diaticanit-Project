-- Phase 6 follow-up: track the user's own explicit asks (e.g. "lose 2kg",
-- "improve sleep duration") as a flexible list of label/value pairs distinct
-- from the structured nutrient/exercise/habit targets, so the Targets page
-- can display what the user specifically asked for alongside the plan.

alter table public.user_target_profiles
  add column user_targets jsonb not null default '[]'::jsonb;
