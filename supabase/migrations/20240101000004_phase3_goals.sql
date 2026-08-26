-- Phase 3 goals: free-text goals translated into deterministic daily targets.

create extension if not exists pgcrypto;

create table if not exists public.user_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_goal_text text not null,
  goal_type text not null
    check (goal_type in ('weight_loss','weight_gain','maintain','general')),
  target_delta_kg numeric(6,2),
  duration_days int,
  target_weight_kg numeric(6,2),
  daily_calorie_delta int not null default 0,
  protein_target_g numeric(6,1) not null,
  hydration_target_l numeric(5,2) not null,
  steps_target int not null,
  translation_confidence numeric(5,4) not null default 0.5
    check (translation_confidence >= 0 and translation_confidence <= 1),
  assumptions text[] not null default '{}',
  is_active boolean not null default true,
  translated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_goals_user_id_created_at
  on public.user_goals(user_id, created_at desc);

create unique index if not exists idx_user_goals_single_active
  on public.user_goals(user_id)
  where is_active = true;

create trigger trg_user_goals_updated_at
before update on public.user_goals
for each row
execute function public.set_updated_at();

alter table public.user_goals enable row level security;

create policy "user_goals_select_own"
on public.user_goals
for select
using (auth.uid() = user_id);

create policy "user_goals_insert_own"
on public.user_goals
for insert
with check (auth.uid() = user_id);

create policy "user_goals_update_own"
on public.user_goals
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_goals_delete_own"
on public.user_goals
for delete
using (auth.uid() = user_id);
