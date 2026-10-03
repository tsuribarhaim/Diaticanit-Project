-- Phase 22 follow-up: a "draft" ticket status (Tsuri's request) - lets a
-- tester open a ticket, save it, and keep gathering information (more
-- detail, attachments) across multiple sessions before it's ready to be
-- treated as a real, actionable ticket. Distinct from every existing
-- status: nobody should triage/act on a draft, and unlike every other
-- status it's allowed to be genuinely incomplete (missing type/area/
-- description) while in this state, since gathering that information over
-- time - not having it all up front - is the entire point.

alter table public.tickets
  drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (status in (
    'draft', 'open', 'in_progress', 'resolved', 'closed',
    'cancelled', 'duplicate', 'reopened', 'deferred'
  ));

-- ticket_type/area/description become nullable so a fresh draft can start
-- with just a subject (kept not-null throughout - a short working title to
-- find the draft again in My Tickets). The new check constraint below
-- requires all three once the ticket is ever anything other than 'draft' -
-- mirrors how cancelled_reason/deferred_reason are already conditionally
-- required (not null only once their own triggering status applies), just
-- the reverse direction: required in every status EXCEPT one, not required
-- only for one.
alter table public.tickets
  alter column ticket_type drop not null,
  alter column area drop not null,
  alter column description drop not null;

alter table public.tickets
  add constraint tickets_draft_fields_required_once_submitted
  check (
    status = 'draft'
    or (ticket_type is not null and area is not null and description is not null and length(trim(description)) > 0)
  );

-- Self-service insert now also allows creating directly as a draft (a
-- plain user could previously only ever insert with status = 'open' - see
-- tickets_insert_own, 044). Deliberately does NOT also require the
-- type/area/description-present check above at insert time - a fresh
-- draft is allowed to have them null from the start; the constraint above
-- still enforces they're present by the time status ever becomes
-- anything else.
drop policy if exists "tickets_insert_own" on public.tickets;
create policy "tickets_insert_own"
on public.tickets
for insert
with check (auth.uid() = created_by and status in ('open', 'draft'));

-- Editable while drafting, same shape as the existing open/in_progress/
-- reopened editable-status policy (057) - a draft needs MORE editing
-- freedom than a live ticket, not less, since filling in the gaps left by
-- the insert above is the entire point.
drop policy if exists "tickets_edit_own" on public.tickets;
create policy "tickets_edit_own"
on public.tickets
for update
using (auth.uid() = created_by and status in ('draft', 'open', 'in_progress', 'reopened'))
with check (auth.uid() = created_by and status in ('draft', 'open', 'in_progress', 'reopened'));

-- Self-service submit, draft -> open only - the tester's own "I'm ready,
-- treat this as a real ticket now" action, same shape as the existing
-- tickets_reopen_own transition policy. tickets_draft_fields_required_
-- once_submitted above is what actually guarantees type/area/description
-- are filled in by the time this succeeds; this policy only grants the
-- transition itself.
create policy "tickets_submit_own"
on public.tickets
for update
using (auth.uid() = created_by and status = 'draft')
with check (auth.uid() = created_by and status = 'open');

-- Attachments stay removable while drafting too, same reasoning as the
-- edit policy above - a tester gathering evidence needs to be able to
-- swap out a bad screenshot for a better one.
drop policy if exists "ticket_attachments_delete_own" on public.ticket_attachments;
create policy "ticket_attachments_delete_own"
on public.ticket_attachments
for delete
using (
  exists (
    select 1 from public.tickets t
    where t.id = ticket_attachments.ticket_id
      and t.created_by = auth.uid()
      and t.status in ('draft', 'open', 'in_progress', 'reopened')
  )
);
