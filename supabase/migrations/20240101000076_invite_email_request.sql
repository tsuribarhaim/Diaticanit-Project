-- The admin's "Add new user" popup can send the new person a welcome email. The click leaves an automation_requests row of the new
-- kind 'invite' (details: the email address and the language); the n8n poller on the admin's laptop picks it up and sends the email,
-- the same way it already handles the other kinds. Only the allowed kinds change: no data is touched and nothing is removed.

alter table public.automation_requests
  drop constraint if exists automation_requests_kind_check;

alter table public.automation_requests
  add constraint automation_requests_kind_check
  check (kind in ('analyze', 'merge', 'revert', 'promote', 'learn', 'night', 'digest', 'invite'));
