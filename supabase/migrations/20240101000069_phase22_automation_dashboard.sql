-- Phase 22 follow-up: the Ticket Automation dashboard (see docs/design/ticket-automation-dashboard.md).
--   automation_events   - the audit trail of the admin's sign-offs and the automation's hand-offs, per ticket
--   automation_runs     - one row per analyst / night run (feeds the status strip)
--   automation_settings - single row: the Pause switch for the two AI agents
--   automation_requests.kind gains 'night' and 'digest' (the "run now" buttons)
alter table public.automation_requests
  drop constraint if exists automation_requests_kind_check;

alter table public.automation_requests
  add constraint automation_requests_kind_check
  check (kind in ('analyze', 'merge', 'revert', 'promote', 'learn', 'night', 'digest'));

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null,
  actor uuid references auth.users(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_events_ticket_idx on public.automation_events (ticket_id, created_at desc);

alter table public.automation_events enable row level security;

create policy "automation_events_select_admin"
on public.automation_events
for select
using (public.is_admin());

create policy "automation_events_insert_admin"
on public.automation_events
for insert
with check (public.is_admin() and actor = auth.uid());

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('analyst', 'night')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tickets_count integer not null default 0,
  cost_usd numeric(8, 2),
  result text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists automation_runs_started_idx on public.automation_runs (started_at desc);

alter table public.automation_runs enable row level security;

create policy "automation_runs_select_admin"
on public.automation_runs
for select
using (public.is_admin());

create table if not exists public.automation_settings (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  paused_by uuid references auth.users(id),
  paused_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.automation_settings (id) values (true) on conflict (id) do nothing;

alter table public.automation_settings enable row level security;

create policy "automation_settings_select_admin"
on public.automation_settings
for select
using (public.is_admin());

create policy "automation_settings_update_admin"
on public.automation_settings
for update
using (public.is_admin())
with check (public.is_admin());
