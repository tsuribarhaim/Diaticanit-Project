-- Phase 24: schema foundation for the onboarding redesign (see
-- docs/design/onboarding-redesign.md) - Phase 1 of that doc's own
-- implementation plan (§9). Three changes, all resolved decisions from
-- that doc's §7:
--
-- 1. has_allergies: a new yes/no gate mirroring has_medical_conditions/
--    has_regular_medications exactly (see 014_phase5_profile_versions_
--    onboarding_fields.sql for those) - makes "you must actively answer,
--    even if the answer is none" a real, explicit fact instead of
--    inferring it from an empty allergies array, which can't distinguish
--    "confirmed none" from "never asked."
-- 2. dietary_preference: adds kosher and gluten_free to the existing
--    4-value check constraint.
-- 3. nutritional_goal: collapses from 5 values down to the 3 values
--    TargetGoalType (lib/targets.ts) already uses - weight_loss,
--    weight_gain, maintain - eliminating the two-enum reconciliation
--    problem entirely rather than mapping between them at read time.
--    Existing rows are backfilled with the agreed one-time mapping
--    BEFORE the stricter constraint is applied, or the migration would
--    fail against any profile still holding one of the retired values.

alter table public.user_profile
  add column if not exists has_allergies boolean;

-- Best-effort inference for already-onboarded users: true if they logged
-- at least one allergy, left null (not false) otherwise - an empty array
-- historically could mean "confirmed none" or "was never asked," and
-- unlike future onboarding sessions (which will always get an explicit
-- answer), there's no way to tell those apart in already-collected data.
update public.user_profile
set has_allergies = true
where has_allergies is null
  and allergies is not null
  and array_length(allergies, 1) > 0;

-- nutritional_goal backfill (see docs/design/onboarding-redesign.md §7.4
-- for the reasoning): the OLD constraint must be dropped first, not
-- after - it never allowed 'maintain'/'weight_gain' (only 'maintenance'
-- was ever valid, a different string), so writing the backfilled values
-- while that constraint was still active failed outright the first time
-- this migration ran.
alter table public.user_profile
  drop constraint if exists user_profile_nutritional_goal_check;

update public.user_profile
set nutritional_goal = case nutritional_goal
  when 'maintenance' then 'maintain'
  when 'muscle_hypertrophy' then 'weight_gain'
  when 'body_recomposition' then 'maintain'
  when 'athletic_performance' then 'maintain'
  else nutritional_goal
end
where nutritional_goal in ('maintenance', 'muscle_hypertrophy', 'body_recomposition', 'athletic_performance');

alter table public.user_profile
  add constraint user_profile_nutritional_goal_check
  check (
    nutritional_goal is null
    or nutritional_goal in ('weight_loss', 'weight_gain', 'maintain')
  );

alter table public.user_profile
  drop constraint if exists user_profile_dietary_preference_check;

alter table public.user_profile
  add constraint user_profile_dietary_preference_check
  check (
    dietary_preference is null
    or dietary_preference in ('standard', 'vegetarian', 'vegan', 'low_carb_keto', 'kosher', 'gluten_free')
  );
