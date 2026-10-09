-- Phase 26 (TCK-119): the "Lifestyle habits" questionnaire replaces the old habits block (Smoking / Regular alcohol / None chips,
-- Low/High alcohol, cigarettes per day). Four new answers, all optional (a question can be skipped), all nullable text with a check:
--   alcohol_weekly_frequency   none | rare | 1_3 | 4_7 | over_7           (drinks per week)
--   smoking_status             never | former | social | daily
--   smoking_cigarettes_range   1_5 | 6_10 | 11_20 | over_20              (only meaningful when smoking_status = daily)
--   caffeine_cups_per_day      0 | 1_2 | 3_4 | 5_plus
--
-- Additive only, so the code that is live today keeps working after it is applied: no backfill, no dropped column. The old fields
-- (habits, alcohol_consumption_level, smoking_packs_per_day) stay and are still filled in by the app when the new answers are
-- saved, so targets, the AI profile chat and the targets review flag keep working unchanged.
--
-- The view is refreshed in the same file, same pattern and reason as 016, 018, 029 and 073: `select p.*, ...` freezes its column
-- list when it is created, the profile pages read through it, and selecting a column it does not have fails there, which those
-- pages treat as "no profile found" (redirect to onboarding, the loop 029 fixed). The definition is otherwise identical to 033.

alter table public.user_profile add column if not exists alcohol_weekly_frequency text;
alter table public.user_profile add column if not exists smoking_status text;
alter table public.user_profile add column if not exists smoking_cigarettes_range text;
alter table public.user_profile add column if not exists caffeine_cups_per_day text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_profile_alcohol_weekly_frequency_check' and conrelid = 'public.user_profile'::regclass) then
    alter table public.user_profile add constraint user_profile_alcohol_weekly_frequency_check
      check (alcohol_weekly_frequency is null or alcohol_weekly_frequency in ('none', 'rare', '1_3', '4_7', 'over_7'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profile_smoking_status_check' and conrelid = 'public.user_profile'::regclass) then
    alter table public.user_profile add constraint user_profile_smoking_status_check
      check (smoking_status is null or smoking_status in ('never', 'former', 'social', 'daily'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profile_smoking_cigarettes_range_check' and conrelid = 'public.user_profile'::regclass) then
    alter table public.user_profile add constraint user_profile_smoking_cigarettes_range_check
      check (smoking_cigarettes_range is null or smoking_cigarettes_range in ('1_5', '6_10', '11_20', 'over_20'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profile_caffeine_cups_per_day_check' and conrelid = 'public.user_profile'::regclass) then
    alter table public.user_profile add constraint user_profile_caffeine_cups_per_day_check
      check (caffeine_cups_per_day is null or caffeine_cups_per_day in ('0', '1_2', '3_4', '5_plus'));
  end if;
end;
$$;

drop view if exists public.user_profile_enriched;

create view public.user_profile_enriched as
select
  p.*,
  case
    when p.date_of_birth is not null then date_part('year', age(current_date, p.date_of_birth))::int
    else p.age
  end as calculated_age_years,
  case
    when p.height_cm is not null and p.height_cm > 0 and p.weight_kg is not null then
      round((p.weight_kg / power((p.height_cm / 100.0), 2))::numeric, 2)
    else null
  end as bmi
from public.user_profile p;
