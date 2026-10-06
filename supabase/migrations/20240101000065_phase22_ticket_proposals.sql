-- Phase 22 follow-up: spec-first Auto Ticket Handling (see docs/design/auto-ticket-handling.md).
--
-- ticket_proposals holds everything the automation hands to the admin for a decision or a
-- review - one row per hand-off, kept as history:
--   kind 'proposal'  - the analyst's findings, decisions, mockups and brief (ticket flag 'A')
--   kind 'questions' - the night run stopped and asks the admin something (flag 'P')
--   kind 'fix'       - the night run committed a fix on a local branch (flag 'D')
-- Admin-only on purpose: an unapproved proposal must never be visible to the ticket's creator.
-- Rows are inserted by the automation API with the service-role key (which bypasses RLS);
-- admins can read them and record their decision.
create table if not exists public.ticket_proposals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('proposal', 'questions', 'fix')),
  version integer not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested', 'rejected', 'superseded',
                      'answered', 'taken_out', 'merged', 'returned')),
  payload jsonb not null default '{}'::jsonb,
  admin_comment text,
  chosen jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id)
);

create index if not exists ticket_proposals_ticket_idx
  on public.ticket_proposals (ticket_id, created_at desc);

alter table public.ticket_proposals enable row level security;

create policy "ticket_proposals_select_admin"
on public.ticket_proposals
for select
using (public.is_admin());

create policy "ticket_proposals_update_admin"
on public.ticket_proposals
for update
using (public.is_admin())
with check (public.is_admin());

-- "Run analysis now" and "Merge to dev" are clicked in the web app, but the code that does the
-- work runs on the admin's laptop, which the hosted app cannot call. The click leaves a row
-- here; an n8n poller on the laptop picks it up within minutes and reports back.
create table if not exists public.automation_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('analyze', 'merge')),
  ticket_id uuid references public.tickets(id) on delete cascade,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  picked_at timestamptz,
  completed_at timestamptz,
  result text
);

create index if not exists automation_requests_pending_idx
  on public.automation_requests (requested_at) where completed_at is null;

alter table public.automation_requests enable row level security;

create policy "automation_requests_select_admin"
on public.automation_requests
for select
using (public.is_admin());

create policy "automation_requests_insert_admin"
on public.automation_requests
for insert
with check (public.is_admin() and requested_by = auth.uid());
