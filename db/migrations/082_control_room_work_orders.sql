-- Control room and the night planner (agreed 2026-10-15).
-- 1. automation_runs: every agent run says who started it (trigger) and the triage / planner runs can be recorded
--    (the 'triage' kind was refused by the old check, so the 16:00 scans never reached the run history).
-- 2. automation_work_orders: the planner's plan for one night - which jobs the night run builds, in which order, and what
--    waits (with the reason). Rebuilt after the analyst and again when the night run starts; the admin can pull a job out.

alter table public.automation_runs add column if not exists trigger text;

do $$
declare
  c record;
begin
  -- The kind check is found by what it checks, never by an assumed name.
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.automation_runs'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.automation_runs drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.automation_runs
  add constraint automation_runs_kind_check check (kind in ('analyst', 'night', 'triage', 'planner'));

alter table public.automation_runs drop constraint if exists automation_runs_trigger_check;
alter table public.automation_runs
  add constraint automation_runs_trigger_check check (trigger is null or trigger in ('schedule', 'manual', 'batch', 'auto'));

-- jobs:     [{ position, ticketIds, seqs, subjects, bundleLetter, inBatch, files, migrationNumber, estimateUsd, risk, pulled }]
-- deferred: [{ ticketId, seq, subject, reason, detail, waitsFor }]
-- outcome:  [{ position, seqs, result }] after the night run (merged | built | stopped | not_reached)
create table if not exists public.automation_work_orders (
  id uuid primary key default gen_random_uuid(),
  night_date date not null,
  status text not null default 'planned' check (status in ('planned', 'running', 'done', 'superseded')),
  created_at timestamptz not null default now(),
  planned_by text not null default 'analyst' check (planned_by in ('analyst', 'night', 'admin')),
  base_ref text,
  budget_usd numeric(8, 2),
  estimate_usd numeric(8, 2),
  success_estimate numeric(4, 3),
  jobs jsonb not null default '[]'::jsonb,
  deferred jsonb not null default '[]'::jsonb,
  outcome jsonb,
  success_rate numeric(4, 3),
  finished_at timestamptz
);

create index if not exists automation_work_orders_night_idx on public.automation_work_orders (night_date desc, created_at desc);

alter table public.automation_work_orders enable row level security;

drop policy if exists "automation_work_orders_select_admin" on public.automation_work_orders;
create policy "automation_work_orders_select_admin"
on public.automation_work_orders
for select
using (public.is_admin());

drop policy if exists "automation_work_orders_update_admin" on public.automation_work_orders;
create policy "automation_work_orders_update_admin"
on public.automation_work_orders
for update
using (public.is_admin())
with check (public.is_admin());
