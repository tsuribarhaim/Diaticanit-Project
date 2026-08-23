-- Add short free-text details for exercise modality "other"
-- and refresh enriched view expansion.

alter table if exists public.user_profile
  add column if not exists exercise_modality_other_details text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_exercise_other_details_len_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_exercise_other_details_len_check
      check (
        exercise_modality_other_details is null
        or char_length(exercise_modality_other_details) <= 80
      );
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
