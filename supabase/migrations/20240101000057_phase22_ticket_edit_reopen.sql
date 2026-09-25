-- Phase 22 follow-up: self-service ticket editing + reopening (see ticket
-- #17's own successor request, "עריכת טיקט" - a user wants to add more
-- information to a ticket, or reopen one that turned out not to actually
-- be fixed). Two new UPDATE policies alongside the existing
-- tickets_cancel_own/tickets_update_admin ones (multiple permissive UPDATE
-- policies on the same table already coexist here - each is its own
-- complete using+with_check gate, combined with OR, exactly like those two
-- already do), plus a DELETE policy on ticket_attachments and on the
-- storage bucket (removing an attachment during an edit) - neither existed
-- before, since a ticket used to have no self-service edit at all beyond
-- Cancel.

-- Lets the owner edit subject/ticket_type/area/priority/description while
-- the ticket is still "live" (open, in_progress, or reopened) - NOT
-- resolved, which is the whole point of the reopen policy below: you
-- reopen first (with a required explanation), which is what makes it
-- editable again, rather than silently editing a ticket support already
-- considers done. with_check's own status clause is a defense-in-depth
-- backstop (the app never sends a status field through this path at all,
-- so a normal edit leaves status untouched regardless) against a raw API
-- call trying to smuggle a status value outside this set through here.
create policy "tickets_edit_own"
on public.tickets
for update
using (auth.uid() = created_by and status in ('open', 'in_progress', 'reopened'))
with check (auth.uid() = created_by and status in ('open', 'in_progress', 'reopened'));

-- Self-service reopen, resolved -> reopened only. Closed tickets are
-- deliberately NOT covered here - per the same "only testers/admin can
-- close" rule this app already applies, only testers/admin can reopen a
-- closed one too (they already can, via tickets_update_admin - no new
-- policy needed for that side). The app enforces "must include an
-- explanation" (the reopen note that becomes the ticket's next dated
-- history entry) since that's about the CONTENT of the description
-- field's append, which isn't something a row-level CHECK constraint can
-- verify (there's no separate column to check against - see lib/tickets.ts
-- for the actual append-log format).
create policy "tickets_reopen_own"
on public.tickets
for update
using (auth.uid() = created_by and status = 'resolved')
with check (auth.uid() = created_by and status = 'reopened');

-- Removing an attachment during an edit - same ownership shape as the
-- existing ticket_attachments_insert_own policy, plus the same
-- editable-status gate tickets_edit_own uses, so an attachment can't be
-- pulled off a ticket that's no longer in an editable state either.
create policy "ticket_attachments_delete_own"
on public.ticket_attachments
for delete
using (
  exists (
    select 1 from public.tickets t
    where t.id = ticket_attachments.ticket_id
      and t.created_by = auth.uid()
      and t.status in ('open', 'in_progress', 'reopened')
  )
);

-- Storage counterpart - object policies can't join back to the tickets
-- table for a status check the way the table policy above can, so that
-- gate is enforced in the server action instead (it already loads and
-- status-checks the ticket before calling storage.remove() at all); this
-- policy only re-confirms ownership of the folder, same shape as the
-- existing ticket_attachments_insert_own storage policy.
create policy "ticket_attachments_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'ticket-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
