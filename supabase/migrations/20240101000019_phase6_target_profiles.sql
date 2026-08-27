-- Phase 6: Dynamic Target-Setting Engine. Replaces the free-text user_goals
-- system with a versioned, range-based nutrition/exercise/habit target profile.
-- No production users exist yet, so user_goals and its data are dropped outright
-- rather than migrated.

drop index if exists public.idx_user_daily_reports_user_goal_report_at;

alter table public.user_daily_reports
  drop column if exists goal_id;

drop table if exists public.user_goals;

create table public.user_target_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Versioning / audit trail
  is_active boolean not null default true,
  sys_start_date timestamptz not null default now(),
  sys_end_date timestamptz,

  -- Goal intent (replaces user_goals' purpose)
  raw_goal_text text not null default '',
  goal_type text not null default 'maintain'
    check (goal_type in ('weight_loss', 'weight_gain', 'maintain', 'general')),
  target_weight_kg numeric(6,2),
  duration_days int,
  blood_balance_focus boolean not null default false,
  sleep_focus boolean not null default false,

  -- Layer A: primary nutrient ranges (always visible)
  calories_min numeric(8,2) not null,
  calories_max numeric(8,2) not null,
  protein_min_g numeric(8,2) not null,
  protein_max_g numeric(8,2) not null,
  carbs_min_g numeric(8,2) not null,
  carbs_max_g numeric(8,2) not null,
  fats_min_g numeric(8,2) not null,
  fats_max_g numeric(8,2) not null,
  fiber_min_g numeric(8,2) not null,
  fiber_max_g numeric(8,2) not null,
  sodium_min_mg numeric(8,2) not null,
  sodium_max_mg numeric(8,2) not null,
  added_sugar_min_g numeric(8,2) not null,
  added_sugar_max_g numeric(8,2) not null,
  water_min_ml numeric(8,2) not null,
  water_max_ml numeric(8,2) not null,

  -- Layer B: secondary nutrient ranges (behind the accordion)
  potassium_min_mg numeric(8,2) not null,
  potassium_max_mg numeric(8,2) not null,
  magnesium_min_mg numeric(8,2) not null,
  magnesium_max_mg numeric(8,2) not null,
  calcium_min_mg numeric(8,2) not null,
  calcium_max_mg numeric(8,2) not null,
  iron_min_mg numeric(8,2) not null,
  iron_max_mg numeric(8,2) not null,
  zinc_min_mg numeric(8,2) not null,
  zinc_max_mg numeric(8,2) not null,
  vit_c_min_mg numeric(8,2) not null,
  vit_c_max_mg numeric(8,2) not null,
  vit_b12_min_mcg numeric(8,2) not null,
  vit_b12_max_mcg numeric(8,2) not null,
  vit_d_min_mcg numeric(8,2) not null,
  vit_d_max_mcg numeric(8,2) not null,
  sat_fat_min_g numeric(8,2) not null,
  sat_fat_max_g numeric(8,2) not null,
  omega3_min_g numeric(8,2) not null,
  omega3_max_g numeric(8,2) not null,

  -- Exercise & habits (structured, not free text)
  exercise_targets jsonb not null default '[]'::jsonb,
  habits_do jsonb not null default '[]'::jsonb,
  habits_dont jsonb not null default '[]'::jsonb,

  -- AI meta
  ai_rationale_explanation text not null default '',
  translation_confidence numeric(5,4) not null default 0.5
    check (translation_confidence >= 0 and translation_confidence <= 1),
  requires_confirmation boolean not null default true,
  analysis_source text not null default 'heuristic'
    check (analysis_source in ('heuristic', 'ai')),
  generator_version text not null default 'targets-v1',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_user_target_profiles_single_active
  on public.user_target_profiles (user_id)
  where is_active = true;

create index idx_user_target_profiles_history
  on public.user_target_profiles (user_id, sys_start_date, sys_end_date);

create trigger trg_user_target_profiles_updated_at
before update on public.user_target_profiles
for each row
execute function public.set_updated_at();

alter table public.user_target_profiles enable row level security;

create policy "user_target_profiles_select_own"
on public.user_target_profiles
for select
using (auth.uid() = user_id);

create policy "user_target_profiles_insert_own"
on public.user_target_profiles
for insert
with check (auth.uid() = user_id);

create policy "user_target_profiles_update_own"
on public.user_target_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_target_profiles_delete_own"
on public.user_target_profiles
for delete
using (auth.uid() = user_id);

alter table public.user_daily_reports
  add column target_profile_id uuid references public.user_target_profiles(id) on delete set null;

create index idx_user_daily_reports_user_target_profile_report_at
  on public.user_daily_reports(user_id, target_profile_id, report_at desc);
