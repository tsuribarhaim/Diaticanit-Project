-- Phase 4 daily reports: free-text daily logging with heuristic parsing and structured metrics.

create extension if not exists pgcrypto;

create table if not exists public.user_daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid references public.user_goals(id) on delete set null,
  raw_report_text text not null,
  report_at timestamptz not null default now(),
  status text not null default 'parsed'
    check (status in ('parsed','needs_confirmation','confirmed')),
  parse_confidence numeric(5,4) not null default 0.5
    check (parse_confidence >= 0 and parse_confidence <= 1),
  requires_confirmation boolean not null default false,
  confirmed_at timestamptz,
  calories_kcal numeric(8,2) not null default 0,
  protein_g numeric(8,2) not null default 0,
  carbs_g numeric(8,2) not null default 0,
  fat_g numeric(8,2) not null default 0,
  water_ml numeric(8,2) not null default 0,
  magnesium_mg numeric(8,2) not null default 0,
  potassium_mg numeric(8,2) not null default 0,
  iron_mg numeric(8,2) not null default 0,
  zinc_mg numeric(8,2) not null default 0,
  exercise_minutes int not null default 0,
  estimated_burn_kcal numeric(8,2) not null default 0,
  parsed_items jsonb not null default '[]'::jsonb,
  parsed_exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_daily_reports_user_id_report_at
  on public.user_daily_reports(user_id, report_at desc);

create trigger trg_user_daily_reports_updated_at
before update on public.user_daily_reports
for each row
execute function public.set_updated_at();

alter table public.user_daily_reports enable row level security;

create policy "user_daily_reports_select_own"
on public.user_daily_reports
for select
using (auth.uid() = user_id);

create policy "user_daily_reports_insert_own"
on public.user_daily_reports
for insert
with check (auth.uid() = user_id);

create policy "user_daily_reports_update_own"
on public.user_daily_reports
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_daily_reports_delete_own"
on public.user_daily_reports
for delete
using (auth.uid() = user_id);
