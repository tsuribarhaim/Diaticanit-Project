-- Support multiple named "Other" exercise activities (e.g. both Dance and
-- Pilates), each with its own frequency/duration, instead of the single
-- exercise_modality_other_details free-text field + one shared "other"
-- schedule entry added in 017/018.

alter table if exists public.user_profile
  add column if not exists exercise_other_activities jsonb not null default '[]'::jsonb;

-- Backfill existing single-activity data (name from the old free-text
-- column, schedule from the old shared "other" key in
-- exercise_schedule_by_modality, falling back to the legacy summary
-- columns) into the new array shape so nothing existing users already
-- entered is lost.
update public.user_profile p
set exercise_other_activities = jsonb_build_array(
  jsonb_build_object(
    'name', p.exercise_modality_other_details,
    'days_per_week', coalesce(
      (p.exercise_schedule_by_modality -> 'other' ->> 'days_per_week')::int,
      nullif(p.exercise_frequency_days_per_week, 0),
      1
    ),
    'minutes_per_session', coalesce(
      (p.exercise_schedule_by_modality -> 'other' ->> 'minutes_per_session')::int,
      nullif(p.exercise_duration_minutes, 0),
      30
    )
  )
)
where p.exercise_modality_other_details is not null
  and length(trim(p.exercise_modality_other_details)) > 0
  and (p.exercise_other_activities is null or p.exercise_other_activities = '[]'::jsonb);

-- Refresh view so the newly added column is projected (see 018/029 - a
-- `select p.*` view freezes its column list at creation time and does not
-- automatically pick up columns added afterward).
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
