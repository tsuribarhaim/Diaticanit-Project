-- Phase 22: User support tickets (see
-- docs/design/user-support-tickets-design.md) - lets a user open a support
-- ticket (bug report or feature request) from inside the app, see their
-- own tickets and their status, and cancel one still open. Triage,
-- resolution, and root-cause/duplicate linking are support-team-only for
-- this phase, done directly against this table (no agent UI yet) - the
-- schema below is shaped so a later AI-driven merge/resolve process has
-- clean fields to write into, without needing a rework then.

create table public.ticket_root_causes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Sequential, human-facing number - purely for display as "TCK-<n>" and
  -- for the user to reference a ticket in conversation. Every FK/join in
  -- this schema is still by id (the UUID above), not this column - avoids
  -- the ambiguity of a formatted text pointer (e.g. a duplicate-of column
  -- storing "TCK-1042" as a string) ever needing to be parsed back apart.
  ticket_seq bigint generated always as identity,

  created_by uuid not null references auth.users(id) on delete cascade,

  subject text not null,
  ticket_type text not null check (ticket_type in ('bug', 'feature_request')),
  area text not null check (area in (
    'home', 'daily_report', 'targets', 'profile', 'documents',
    'health_labs', 'notifications', 'settings', 'account_auth', 'other'
  )),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  description text not null,

  status text not null default 'open' check (status in (
    'open', 'in_progress', 'resolved', 'closed',
    'cancelled', 'duplicate', 'reopened'
  )),

  cancelled_reason text,
  cancelled_at timestamptz,

  -- Support-team-only from here down - never writable by a plain user (see
  -- the RLS policies below, which grant no update access to these at all).
  root_cause_id uuid references public.ticket_root_causes(id),
  duplicate_of_ticket_id uuid references public.tickets(id),
  fix_description text,
  assigned_to uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint tickets_cancelled_reason_required
    check (status <> 'cancelled' or cancelled_reason is not null),
  constraint tickets_duplicate_of_required
    check (status <> 'duplicate' or duplicate_of_ticket_id is not null),
  constraint tickets_no_self_duplicate
    check (duplicate_of_ticket_id is null or duplicate_of_ticket_id <> id)
);

create unique index idx_tickets_seq on public.tickets (ticket_seq);
create index idx_tickets_created_by on public.tickets (created_by, created_at desc);

create trigger trg_tickets_updated_at
before update on public.tickets
for each row
execute function public.set_updated_at();

-- Duplicate linking is scoped to one user's own tickets - a ticket can
-- only be marked a duplicate of another ticket created by the SAME user,
-- not a cross-user match (per this design's own scope decision).
create or replace function public.enforce_ticket_duplicate_same_user()
returns trigger
language plpgsql
as $$
begin
  if new.duplicate_of_ticket_id is not null then
    if not exists (
      select 1 from public.tickets
      where id = new.duplicate_of_ticket_id
        and created_by = new.created_by
    ) then
      raise exception 'duplicate_of_ticket_id must reference a ticket created by the same user';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_tickets_duplicate_same_user
before insert or update of duplicate_of_ticket_id on public.tickets
for each row
execute function public.enforce_ticket_duplicate_same_user();

-- Notifies the user through the existing user_notifications table/UI
-- (built for Targets concerns, reused as-is here) whenever a ticket's
-- status changes - fires regardless of HOW it changed (a direct dashboard
-- edit today, the planned AI process later), so this never depends on
-- whoever updates a ticket remembering an extra step. field_keys carries a
-- "ticket_<uuid>" entry - a new convention alongside the existing
-- RingMetric-id ones already stored there, harmless since nothing matches
-- against it except a ticket-detail link.
create or replace function public.notify_ticket_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    insert into public.user_notifications (user_id, severity, message, field_keys)
    values (
      new.created_by,
      'info',
      'Your ticket "' || new.subject || '" is now ' || new.status || '.',
      jsonb_build_array('ticket_' || new.id::text)
    );
  end if;
  return new;
end;
$$;

create trigger trg_tickets_notify_status_change
after update of status on public.tickets
for each row
execute function public.notify_ticket_status_change();

alter table public.tickets enable row level security;
alter table public.ticket_root_causes enable row level security;

create policy "tickets_select_own"
on public.tickets
for select
using (auth.uid() = created_by);

create policy "tickets_insert_own"
on public.tickets
for insert
with check (auth.uid() = created_by and status = 'open');

-- The ONLY self-service write after creation: cancelling a still-open
-- ticket. Every other field (status transitions beyond this, fix
-- description, root cause, duplicate linking, assignment) is support-
-- team-only, via service-role access outside RLS entirely - there is no
-- policy granting a plain user update access to them.
create policy "tickets_cancel_own"
on public.tickets
for update
using (auth.uid() = created_by and status in ('open', 'in_progress'))
with check (
  auth.uid() = created_by
  and status = 'cancelled'
  and cancelled_reason is not null
);

-- ticket_root_causes has no user-facing policy at all - support-team/
-- service-role only, matching "no agent UI in this phase" (nothing in the
-- app reads this table yet; it exists so the schema is ready for it).

-- Supabase storage setup for ticket attachments - same per-user-folder
-- pattern as the user-documents bucket (see 001_phase1_schema_rls.sql),
-- kept as its own bucket rather than mixing ticket screenshots into the
-- health-documents one.
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

-- Storage policies (path convention required):
-- ticket-attachments/<auth.uid()>/<file>
create policy "ticket_attachments_read_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "ticket_attachments_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- No update/delete storage policy - an attachment is fixed once a ticket
-- is submitted, same as the ticket content itself has no self-service edit
-- beyond cancelling the whole ticket.
