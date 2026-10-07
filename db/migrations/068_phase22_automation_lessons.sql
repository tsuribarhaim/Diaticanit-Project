-- Phase 22 follow-up: the automation learns from the admin's corrections (see docs/design/auto-ticket-handling.md).
-- Every Send back / returned fix / requested change leaves a 'learn' request; the bridge distils it into one
-- short, general lesson (or decides there is nothing general to learn) and stores it here. The lessons that are
-- active are added to the agents' instructions on their next run, and the admin is e-mailed each time.
-- The admin can switch any lesson off on the Ticket Automation page.
alter table public.automation_requests
  drop constraint if exists automation_requests_kind_check;

alter table public.automation_requests
  add constraint automation_requests_kind_check
  check (kind in ('analyze', 'merge', 'revert', 'promote', 'learn'));

create table if not exists public.automation_lessons (
  id uuid primary key default gen_random_uuid(),
  agent text not null check (agent in ('analyst', 'night', 'both')),
  lesson text not null,
  source_ticket_seq integer,
  source_kind text,
  source_comment text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_by uuid references auth.users(id)
);

create index if not exists automation_lessons_active_idx on public.automation_lessons (active, created_at desc);

alter table public.automation_lessons enable row level security;

create policy "automation_lessons_select_admin"
on public.automation_lessons
for select
using (public.is_admin());

create policy "automation_lessons_update_admin"
on public.automation_lessons
for update
using (public.is_admin())
with check (public.is_admin());
