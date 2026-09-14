-- Phase 10 (Alcohol consumption redesign): the numeric "times per week"
-- field is being replaced by a Low/High consumption category, judged
-- against gender-specific standard-drink thresholds shown to the user in
-- the profile form's info tooltip: female up to 7 drinks/week = low, 8+ =
-- high; male up to 14 drinks/week = low, 15+ = high.
--
-- alcohol_times_per_week is kept in place (never dropped, per this
-- project's migration convention) but the app stops reading/writing it
-- after this ships. Existing values are backfilled into the new column
-- once, below, treating the old stored number as a weekly drink count
-- against those same thresholds - per product decision, rather than
-- leaving every existing user's field blank.

alter table public.user_profile
  add column if not exists alcohol_consumption_level text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_alcohol_consumption_level_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_alcohol_consumption_level_check
      check (alcohol_consumption_level is null or alcohol_consumption_level in ('low', 'high'));
  end if;
end;
$$;

update public.user_profile
set alcohol_consumption_level = case
  when biological_sex = 'male' and alcohol_times_per_week is not null then
    case when alcohol_times_per_week <= 14 then 'low' else 'high' end
  when biological_sex = 'female' and alcohol_times_per_week is not null then
    case when alcohol_times_per_week <= 7 then 'low' else 'high' end
  else null
end
where alcohol_consumption_level is null;
