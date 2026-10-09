-- Phase 26 (TCK-118): a second goal in onboarding, next to the weight goal.
--
-- The existing nutritional_goal column is the WEIGHT goal (weight_loss / weight_gain / maintain, see 051) and stays exactly as it
-- is - its visible label becomes "Weight goal". The new goal is a multi-select:
--   maintain_health   keep my health as it is
--   muscle_gain       build muscle mass
--   abnormal_markers  improve blood markers that are out of range (health_goals_markers_details says which)
--   other             anything else (health_goals_other_details says what)
--
-- This is additive only, so the code that is live today keeps working after it is applied: three new columns with defaults, no
-- backfill, no change to nutritional_goal, any view or any row-level-security policy. user_profile_versions snapshots rows with
-- to_jsonb(new) (014), so the new columns are versioned automatically.
-- It is applied ahead of the code that uses it, so the code can ship without a database step.

alter table public.user_profile add column if not exists health_goals text[] not null default '{}';
alter table public.user_profile add column if not exists health_goals_markers_details text;
alter table public.user_profile add column if not exists health_goals_other_details text;

alter table public.user_profile drop constraint if exists user_profile_health_goals_check;
alter table public.user_profile add constraint user_profile_health_goals_check
  check (health_goals <@ array['maintain_health', 'muscle_gain', 'abnormal_markers', 'other']::text[]);
