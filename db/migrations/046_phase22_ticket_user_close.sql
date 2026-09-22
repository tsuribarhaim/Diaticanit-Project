-- Phase 22 follow-up: lets a user close their own ticket once support has
-- marked it resolved - confirming they're satisfied with the fix, distinct
-- from Cancel (which only applies before resolution, while still
-- open/in_progress - see tickets_cancel_own). No reason required, unlike
-- Cancel's cancelled_reason - closing a resolved ticket isn't something
-- that needs justifying the way abandoning one before it's fixed does.
create policy "tickets_close_own"
on public.tickets
for update
using (auth.uid() = created_by and status = 'resolved')
with check (auth.uid() = created_by and status = 'closed');
