-- Phase 22 correction: two things from the previous migration were based
-- on a misunderstanding, corrected here rather than left in place.
--
-- 1) tickets_close_own (046) let a user self-service move a ticket from
--    'resolved' to 'closed'. Not wanted - "Close" on the ticket detail
--    screen was actually meant as a plain "go back to the list" navigation
--    action, not a status change. A user's only self-service status change
--    stays Cancel (tickets_cancel_own, from 044).
drop policy if exists "tickets_close_own" on public.tickets;

-- 2) notify_ticket_status_change (044) notified on every status change.
-- Too noisy - a user should only get a push-style notification when their
-- ticket is actually Closed; every other status (in_progress, resolved,
-- cancelled, etc.) is only ever seen by checking the ticket list/detail
-- directly, not pushed at them.
create or replace function public.notify_ticket_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status = 'closed' then
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
