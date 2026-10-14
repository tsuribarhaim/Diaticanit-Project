-- TCK-3: "Forgot your password?" (on the sign-in page, and in the Change password sheet for a signed-in user who forgot the
-- current one) leaves an automation_requests row of the new kind 'password_reset' (details: the email and the language).
-- The n8n poller hands it to the "Password Reset" workflow, which asks the app for the e-mail at send time - the one-time
-- reset link is built then and never stored here - and sends it from Daffy's own address. Only the allowed kinds change.

alter table public.automation_requests
  drop constraint if exists automation_requests_kind_check;

alter table public.automation_requests
  add constraint automation_requests_kind_check
  check (kind in ('analyze', 'merge', 'revert', 'promote', 'learn', 'night', 'digest', 'invite', 'password_reset'));
