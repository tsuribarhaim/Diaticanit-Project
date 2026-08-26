-- Add per-modality exercise schedule while preserving legacy summary columns.

alter table if exists public.user_profile
  add column if not exists exercise_schedule_by_modality jsonb not null default '{}'::jsonb;

-- Backfill schedule for existing rows that have modalities and legacy summary values.
update public.user_profile p
set exercise_schedule_by_modality = s.schedule_json
from (
  select
    up.id,
    coalesce(
      jsonb_object_agg(
        modality,
        jsonb_build_object(
          'days_per_week', up.exercise_frequency_days_per_week,
          'minutes_per_session', up.exercise_duration_minutes
        )
      ),
      '{}'::jsonb
    ) as schedule_json
  from public.user_profile up
  cross join lateral unnest(coalesce(up.exercise_modalities, '{}'::text[])) as modality
  where modality <> 'none'
    and up.exercise_frequency_days_per_week is not null
    and up.exercise_duration_minutes is not null
    and up.exercise_frequency_days_per_week > 0
    and up.exercise_duration_minutes > 0
  group by up.id
) as s
where p.id = s.id
  and (p.exercise_schedule_by_modality is null or p.exercise_schedule_by_modality = '{}'::jsonb);

-- Refresh view so newly added column is projected.
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
