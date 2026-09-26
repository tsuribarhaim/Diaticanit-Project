-- Phase 22 follow-up: capture the app build the reporter was actually
-- running on, silently, at ticket-submission time - NEXT_PUBLIC_APP_VERSION
-- read client-side and passed through unchanged (createTicketAction,
-- submitTicketFromChatAction), not a form field. Admin-only visibility, for
-- investigating a report without having to ask "which version were you on"
-- - the exact gap that led a session to spend real effort chasing a bug
-- that turned out to already be fixed in a newer build than the reporter
-- was on.

alter table public.tickets
  add column if not exists current_version text;
