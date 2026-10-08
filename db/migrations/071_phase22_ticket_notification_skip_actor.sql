-- Phase 22 follow-up (TCK-72): the "your ticket has been closed" notification.
--
-- 1) Whoever sets the status should not be notified about it. When an admin closed a ticket they had created themselves, the
--    trigger notified them, and the ticket page's mark-read-on-view (apps/web/src/app/app/tickets/[id]/page.tsx) marked that new
--    notification read the moment the page refreshed - so it showed up already "Read". The notification is now skipped when the
--    person changing the status is the ticket's creator. auth.uid() is NULL for service-role / automation writes, and
--    "is distinct from" keeps those notifying the creator as before.
--
-- 2) The function now runs with its owner's rights (security definer, fixed search_path - the same pattern as public.is_admin()
--    in 048). user_notifications only allows inserting a row for the caller's own id (user_notifications_insert_own, 042), so
--    without this an admin closing ANOTHER user's ticket was refused by row-level security and the whole status update failed.
--
-- The message, severity and field_keys are unchanged, read_at stays null, and the trigger itself
-- (trg_tickets_notify_status_change, 044) is not touched - replacing the function is enough.
create or replace function public.notify_ticket_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status = 'closed'
     and new.created_by is distinct from auth.uid() then
    insert into public.user_notifications (user_id, severity, message, field_keys)
    values (
      new.created_by,
      'info',
      'Your ticket "' || new.subject || '" has been closed.',
      jsonb_build_array('ticket_' || new.id::text)
    );
  end if;
  return new;
end;
$$;
