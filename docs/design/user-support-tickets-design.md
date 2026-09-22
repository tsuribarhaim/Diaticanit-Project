# User Support Tickets — Design

Status: design agreed, pending implementation.

Supersedes `Requirements/User-Tickets-Supp;ort_Desgin_V1.docx` (the original
design brief) — that document's screens and general shape are carried
forward here, adapted to this app's actual conventions (Supabase/Postgres,
not the doc's generic MySQL sketch) and revised per the decisions below.

## Goal

Let a signed-in user open a support ticket (a bug report or a feature
request) from inside the app, see the list and status of their own past
tickets, and cancel one they no longer need — without needing email or an
external tool. Ticket triage, resolution, and write-back (status, fix
description, root-cause/duplicate linking) are **not** self-service; they're
handled by the support team directly against the database, with an
AI-driven automation planned for that side later (explicitly out of scope
for this build — see "Explicitly deferred" below).

## Scope decisions (from review of the original doc)

- **No agent/admin UI in this phase.** The support team manages status,
  fix description, root cause, and duplicate-linking by editing rows
  directly in Supabase (the same pattern already used for
  `pilot_allowlist` and everything else administered today). A later phase
  will add an AI-driven process that scans tickets and merges/resolves them
  automatically; this build's schema is shaped so that process has clean
  fields to write into, but the process itself is not built now.
- **Duplicate linking is scoped to one user's own tickets.** A ticket can
  only be marked a duplicate of another ticket created by the *same* user —
  not a cross-user match. Enforced with a check constraint (see schema).
- **Attachments reuse the existing upload infrastructure** (the same
  Storage-bucket-per-file pattern already used for document uploads in
  `documents/actions.ts`), via a new dedicated bucket rather than mixing
  ticket screenshots into the health-documents bucket.
- **Status changes notify the user** through the existing
  `user_notifications` table/UI (the same system built for Targets
  concerns), via a database trigger — not something the support team has to
  remember to do by hand when they edit a row.
- **Two fields replace the original doc's single "Category" dropdown**,
  per your steer:
  - `ticket_type`: `bug` | `feature_request`.
  - `area`: which part of the app the ticket is about. Seeded with the
    app's current sections (`home`, `daily_report`, `targets`, `profile`,
    `documents`, `health_labs`, `notifications`, `settings`,
    `account_auth`, `other`), open to grow as new areas ship.
- **"Billing" dropped** as a category value — there's no billing system in
  this app yet, so it isn't part of `ticket_type`/`area` at all. Revisit
  once billing exists.

## Data model

New migration `db/migrations/044_phase22_user_tickets.sql` (mirrored to
`supabase/migrations/`, per this project's usual dual-file convention).

```sql
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Sequential, human-facing number - the UUID above is the real key used
  -- for every FK/join; this is purely for display as "TCK-<n>" and for the
  -- user to reference a ticket in conversation. A plain identity column
  -- (not a formatted string) avoids the original doc's own inconsistency
  -- between a text "TCK-1042" duplicate pointer and an INT FK - every join
  -- here is by id, and "TCK-<n>" is only ever composed at display time.
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

  -- Support-team-only fields (see "No agent/admin UI" above) - never
  -- writable by a plain user; see RLS policies below.
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

-- Enforces "duplicate linking is scoped to one user's own tickets" - a
-- ticket can only point at another ticket with the same created_by.
create or replace function public.enforce_ticket_duplicate_same_user()
returns trigger as $$
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
$$ language plpgsql;

create trigger trg_tickets_duplicate_same_user
before insert or update of duplicate_of_ticket_id on public.tickets
for each row execute function public.enforce_ticket_duplicate_same_user();

create table public.ticket_root_causes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);
```

**RLS:**

```sql
alter table public.tickets enable row level security;
alter table public.ticket_root_causes enable row level security;

-- A user can see and create only their own tickets.
create policy "tickets_select_own"
on public.tickets for select
using (auth.uid() = created_by);

create policy "tickets_insert_own"
on public.tickets for insert
with check (auth.uid() = created_by and status = 'open');

-- The ONLY self-service write after creation: cancelling a still-open
-- ticket. Every other field (status transitions beyond this, fix
-- description, root cause, duplicate linking, assignment) is support-team-
-- only, via service-role access outside RLS entirely - there is no policy
-- granting a plain user update access to them.
create policy "tickets_cancel_own"
on public.tickets for update
using (auth.uid() = created_by and status in ('open', 'in_progress'))
with check (
  auth.uid() = created_by
  and status = 'cancelled'
  and cancelled_reason is not null
);

-- root_causes has no user-facing policy at all - support-team/service-role
-- only, matching "no agent UI in this phase" (nothing in the app reads
-- this table yet; it exists so the schema is ready for it).
```

**Notification trigger** (mirrors this app's existing "flag it, don't
silently revert" notification pattern from the Targets redesign — see
`docs/design/targets-save-performance-redesign.md`):

```sql
create or replace function public.notify_ticket_status_change()
returns trigger as $$
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
$$ language plpgsql;

create trigger trg_tickets_notify_status_change
after update of status on public.tickets
for each row execute function public.notify_ticket_status_change();
```

Fires regardless of *how* the status changed — a dashboard edit today, the
planned AI process later — so notifications never depend on whoever updates
the ticket remembering an extra step. `user_notifications.field_keys`
already supports arbitrary string ids (see its own migration comment); a
`"ticket_<uuid>"` entry is a new convention alongside the existing
`RingMetric`-id ones, harmless since nothing currently matches against it
except a ticket-detail link (see UI below) — it doesn't attempt to flag a
value on the Targets/Home rings, unlike the Targets-concern notifications
this table was originally built for.

**Storage** (new bucket, same pattern as `user-documents`):

```sql
insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;

-- Same per-user-folder policy shape as user-documents (see 001_phase1_schema_rls.sql):
-- ticket-attachments/<auth.uid()>/<file>
create policy "ticket_attachments_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "ticket_attachments_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
```

No update/delete storage policy — an attachment is fixed once a ticket is
submitted, same as the ticket content itself has no self-service edit.

## UI / screens

All under `/app/profile` → the existing "Account & Support" section
(`src/app/app/profile/page.tsx`), which already has `ComingSoonRow`
placeholders for "Help Center / FAQ" and "Terms of Service" — this adds a
new row there ("Support Tickets" / "פניות תמיכה") linking to My Tickets,
leaving those two untouched. Every screen bilingual (EN/HE) via the
existing `tr()` convention, matching the rest of the app.

1. **New Ticket** (`/app/tickets/new`) — Subject, Type (Bug / Feature
   Request), Area (dropdown, the seeded list above), Priority, Description,
   optional Attachment. Submits via a server action
   (`createTicketAction`), uploads the attachment to `ticket-attachments`
   the same way `documents/actions.ts` uploads to `user-documents` before
   inserting the row, then redirects to My Tickets with a success notice.
2. **My Tickets** (`/app/tickets`) — table of the signed-in user's own
   tickets: number (`TCK-<ticket_seq>`), subject, date, status, and a
   View action (Cancel shown inline only while `open`/`in_progress`, per
   the original doc's own rule). A `[+ New Ticket]` button links to screen 1.
3. **Ticket Detail / View** (`/app/tickets/[id]`) — **not in the original
   doc**, needed for the table's own View action: full subject/type/area/
   priority/description/attachment, current status, and — once resolved —
   the support team's `fix_description`. Also where "Cancel" actually lives
   as a button (opening the same confirm dialog described below), so the
   table's inline Cancel and this screen's Cancel are the same action from
   two entry points.
4. **Cancel confirm dialog** — matches the original doc: a reason field
   pre-filled `"User request"` (editable), Keep Ticket / Confirm. Confirm
   calls `cancelTicketAction`, which is the RLS `tickets_cancel_own` policy
   above in practice — a plain `UPDATE ... SET status = 'cancelled',
   cancelled_reason = ..., cancelled_at = now()`, soft-cancel only, no row
   deletion, so history/audit stays intact (matching the original doc's own
   reasoning).

Status display strings (EN/HE) and their badge colors follow this app's
existing `ProfileRow`/badge conventions rather than inventing a new visual
language.

## Implementation steps

1. **Migration** `044_phase22_user_tickets.sql` (+ mirrored
   `supabase/migrations/` copy): `tickets` + `ticket_root_causes` tables,
   RLS policies, the duplicate-same-user trigger, the notification trigger,
   the `ticket-attachments` bucket and its storage policies. Push to dev
   via `scripts/supabase-db-push.ps1 -Environment dev`.
2. **Shared types/locale strings** — `lib/tickets.ts` (types for
   `TicketType`/`TicketArea`/`TicketPriority`/`TicketStatus`, matching the
   `lib/targets.ts`-style shape already used elsewhere) and the EN/HE
   label maps for each (area names, status names, etc.).
3. **`app/app/tickets/actions.ts`** (`"use server"`):
   `createTicketAction` (validates input via zod, uploads attachment if
   present, inserts the row), `cancelTicketAction` (the soft-cancel
   update).
4. **New Ticket screen** (`app/app/tickets/new/page.tsx` +
   `components/new-ticket-form.tsx`) — form wired to `createTicketAction`,
   `useFormStatus` pending/spinner feedback on submit matching this
   session's established pattern for every other action button in this app.
5. **My Tickets screen** (`app/app/tickets/page.tsx` +
   `components/tickets-table.tsx`) — server-rendered list (RLS already
   scopes it to the signed-in user, so a plain `select *` is safe), Cancel
   trigger + confirm dialog component (`components/cancel-ticket-dialog.tsx`),
   reusing this app's existing bottom-sheet/modal shell
   (`QuickEditSheet`-equivalent) rather than a new one.
6. **Ticket Detail screen** (`app/app/tickets/[id]/page.tsx`) — full
   ticket view, attachment preview/download (signed URL from
   `ticket-attachments`, same pattern as document downloads), Cancel button
   when eligible.
7. **Profile entry point** — add the new row to the "Account & Support"
   section in `profile/page.tsx`, linking to `/app/tickets`.
8. **Notification integration** — confirm the existing
   `/app/notifications` view and nav badge correctly surface a
   `"ticket_<uuid>"`-keyed entry (it's a generic `user_notifications` row,
   so this should work without changes, but needs verifying that clicking
   through resolves to the ticket detail screen rather than assuming a
   Targets destination — check `notifications/page.tsx`'s existing
   click-through logic).
9. **Verification**: `tsc`, `eslint`, `next build`, then a manual run
   through create → view in My Tickets → cancel → confirm the notification
   fires on a support-team-side status edit (a direct Supabase update) —
   same rigor as every other change this session.

## Explicitly deferred (not part of this build)

- Any agent/admin UI for the support team — direct Supabase access only,
  for now.
- The AI-driven scan/merge/auto-resolve process mentioned as a future
  phase. The schema (`root_cause_id`, `duplicate_of_ticket_id`, the
  same-user constraint) is shaped to support it, but no automation code
  ships in this build.
- Email notifications — only the in-app `user_notifications` channel, per
  the decision above.
- A billing ticket category — revisit once a billing system exists.

## Open implementation decisions

- Exact EN/HE copy for each `area`/`ticket_type`/`status` label.
- Whether "Reopened" needs any user-facing entry point at all in this
  phase, or is purely a support-team-set status for now (the original doc
  lists it but neither mocks up nor is asked about a user-facing reopen
  action — currently assumed support-team-only, same as every other status
  beyond Cancel).
- Max attachment size/type list for `ticket-attachments` — proposed to
  mirror `documents/actions.ts`'s existing `MAX_DOCUMENT_SIZE_BYTES`/
  `ALLOWED_DOCUMENT_MIME_TYPES` constants rather than defining new ones,
  pending confirmation.
