-- The daily batch (docs: memory "daily-batch-process"): at 16:00 a triage agent picks up to 8 clear, small open tickets and
-- the admin approves them; the analyst and the night run fix them; the admin approves the promotion; the batch closes.
-- One row per batch. tickets holds the picks: [{ ticketId, seq, subject, reason, needsMigration, state, note }] where state
-- is proposed | unselected | queued | analysing | building | built | out | released.
-- At most one batch is active at a time (the partial unique index), and while one is active the app refuses manual agent runs.

create table if not exists public.automation_batches (
  id uuid primary key default gen_random_uuid(),
  batch_date date not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'building', 'ready', 'promoting', 'done', 'rejected', 'expired', 'failed')),
  tickets jsonb not null default '[]'::jsonb,
  scanned_count integer not null default 0,
  triage_cost_usd numeric(8, 2),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  ready_at timestamptz,
  promoted_at timestamptz,
  version text,
  dev_tested boolean not null default false,
  closed_at timestamptz,
  note text
);

create unique index if not exists automation_batches_one_active
  on public.automation_batches ((true))
  where status in ('proposed', 'approved', 'building', 'ready', 'promoting');

alter table public.automation_batches enable row level security;

drop policy if exists "automation_batches_select_admin" on public.automation_batches;
create policy "automation_batches_select_admin"
on public.automation_batches
for select
using (public.is_admin());

drop policy if exists "automation_batches_update_admin" on public.automation_batches;
create policy "automation_batches_update_admin"
on public.automation_batches
for update
using (public.is_admin())
with check (public.is_admin());
