-- Phase 5 onboarding/profile redesign foundation:
-- 1) add onboarding fields needed for 4-step wizard
-- 2) add version history table with active-row semantics
-- 3) expose calculated age and BMI on read through a view

create extension if not exists pgcrypto;

alter table if exists public.user_profile
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists date_of_birth date,
  add column if not exists biological_sex text,
  add column if not exists weight_unit text,
  add column if not exists height_unit text,
  add column if not exists exercise_modalities text[] not null default '{}',
  add column if not exists exercise_frequency_days_per_week int,
  add column if not exists exercise_duration_minutes int,
  add column if not exists nutritional_goal text,
  add column if not exists pregnancy_lactation_status text,
  add column if not exists has_medical_conditions boolean,
  add column if not exists medical_conditions_details text,
  add column if not exists has_regular_medications boolean,
  add column if not exists regular_medications_details text,
  add column if not exists hot_climate_or_heavy_sweating boolean,
  add column if not exists habits text[] not null default '{}',
  add column if not exists dietary_preference text,
  add column if not exists additional_information text,
  add column if not exists onboarding_version int not null default 1,
  add column if not exists needs_onboarding_refresh boolean not null default false;

-- Backfill deterministic defaults where possible.
update public.user_profile
set
  biological_sex = coalesce(
    biological_sex,
    case
      when lower(gender) in ('male', 'female') then lower(gender)
      else null
    end
  ),
  weight_unit = coalesce(weight_unit, 'kg'),
  height_unit = coalesce(height_unit, 'cm'),
  has_medical_conditions = coalesce(has_medical_conditions, cardinality(medical_conditions) > 0),
  has_regular_medications = coalesce(has_regular_medications, false),
  hot_climate_or_heavy_sweating = coalesce(hot_climate_or_heavy_sweating, false),
  additional_information = coalesce(additional_information, ''),
  needs_onboarding_refresh = coalesce(needs_onboarding_refresh, false)
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_biological_sex_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_biological_sex_check
      check (biological_sex is null or biological_sex in ('male', 'female'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_weight_unit_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_weight_unit_check
      check (weight_unit in ('kg', 'lbs'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_height_unit_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_height_unit_check
      check (height_unit in ('cm', 'ft_in'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_exercise_frequency_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_exercise_frequency_check
      check (
        exercise_frequency_days_per_week is null
        or (exercise_frequency_days_per_week >= 0 and exercise_frequency_days_per_week <= 14)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_exercise_duration_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_exercise_duration_check
      check (
        exercise_duration_minutes is null
        or (exercise_duration_minutes >= 0 and exercise_duration_minutes <= 600)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_nutritional_goal_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_nutritional_goal_check
      check (
        nutritional_goal is null
        or nutritional_goal in (
          'maintenance',
          'weight_loss',
          'muscle_hypertrophy',
          'body_recomposition',
          'athletic_performance'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_pregnancy_lactation_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_pregnancy_lactation_check
      check (
        pregnancy_lactation_status is null
        or pregnancy_lactation_status in ('none', 'pregnant', 'lactating')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_dietary_preference_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_dietary_preference_check
      check (
        dietary_preference is null
        or dietary_preference in ('standard', 'vegetarian', 'vegan', 'low_carb_keto')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_additional_information_len_check'
      and conrelid = 'public.user_profile'::regclass
  ) then
    alter table public.user_profile
      add constraint user_profile_additional_information_len_check
      check (additional_information is null or char_length(additional_information) <= 1000);
  end if;
end;
$$;

-- Existing users are missing the new mandatory onboarding fields.
-- Mark them for re-onboarding when key fields are absent.
update public.user_profile
set needs_onboarding_refresh = true
where
  first_name is null
  or last_name is null
  or date_of_birth is null
  or nutritional_goal is null
  or dietary_preference is null;

create table if not exists public.user_profile_versions (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.user_profile(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_no int not null,
  is_active boolean not null default true,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, version_no)
);

create unique index if not exists idx_user_profile_versions_active_user
  on public.user_profile_versions(user_id)
  where is_active;

create index if not exists idx_user_profile_versions_user_id_created_at
  on public.user_profile_versions(user_id, created_at desc);

drop trigger if exists trg_user_profile_versions_updated_at on public.user_profile_versions;
create trigger trg_user_profile_versions_updated_at
before update on public.user_profile_versions
for each row
execute function public.set_updated_at();

create or replace function public.capture_user_profile_version()
returns trigger
language plpgsql
as $$
declare
  next_version int;
begin
  update public.user_profile_versions
  set is_active = false,
      updated_at = now()
  where user_id = new.user_id
    and is_active = true;

  select coalesce(max(version_no), 0) + 1
  into next_version
  from public.user_profile_versions
  where user_id = new.user_id;

  insert into public.user_profile_versions (
    user_profile_id,
    user_id,
    version_no,
    is_active,
    snapshot,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.user_id,
    next_version,
    true,
    to_jsonb(new),
    now(),
    now()
  );

  return new;
end;
$$;

drop trigger if exists trg_capture_user_profile_version on public.user_profile;
create trigger trg_capture_user_profile_version
after insert or update on public.user_profile
for each row
execute function public.capture_user_profile_version();

-- Backfill an initial active version for existing profiles when absent.
insert into public.user_profile_versions (
  user_profile_id,
  user_id,
  version_no,
  is_active,
  snapshot,
  created_at,
  updated_at
)
select
  p.id,
  p.user_id,
  1,
  true,
  to_jsonb(p),
  coalesce(p.updated_at, p.created_at, now()),
  coalesce(p.updated_at, p.created_at, now())
from public.user_profile p
where not exists (
  select 1
  from public.user_profile_versions v
  where v.user_id = p.user_id
);

alter table public.user_profile_versions enable row level security;

create policy "profile_versions_select_own"
on public.user_profile_versions
for select
using (auth.uid() = user_id);

create policy "profile_versions_insert_own"
on public.user_profile_versions
for insert
with check (auth.uid() = user_id);

create policy "profile_versions_update_own"
on public.user_profile_versions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "profile_versions_delete_own"
on public.user_profile_versions
for delete
using (auth.uid() = user_id);

create or replace view public.user_profile_enriched as
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
