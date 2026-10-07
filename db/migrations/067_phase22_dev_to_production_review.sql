-- Phase 22 follow-up: the dev -> production half of Auto Ticket Handling (see docs/design/auto-ticket-handling.md).
--   auto_handle 'M' - the fix is merged on dev and waits for the admin's test
--   auto_handle 'R' - the admin approved it for production; the next "Promote to production" ships it
-- ticket_proposals.status gains 'released' (the fix reached production).
-- automation_requests gains two kinds: 'revert' (undo a merge on dev - "Send back") and 'promote'
-- (ship every approved fix), plus a free-form `details` column carrying the request's inputs
-- (the admin's comment for a revert, the ticket list for a promote) and, on completion, its report.
alter table public.tickets
  drop constraint if exists tickets_auto_handle_check;

alter table public.tickets
  add constraint tickets_auto_handle_check
  check (auto_handle in ('Y', 'P', 'D', 'S', 'A', 'M', 'R'));

alter table public.ticket_proposals
  drop constraint if exists ticket_proposals_status_check;

alter table public.ticket_proposals
  add constraint ticket_proposals_status_check
  check (status in ('pending', 'approved', 'changes_requested', 'rejected', 'superseded',
                    'answered', 'taken_out', 'merged', 'returned', 'released'));

alter table public.automation_requests
  drop constraint if exists automation_requests_kind_check;

alter table public.automation_requests
  add constraint automation_requests_kind_check
  check (kind in ('analyze', 'merge', 'revert', 'promote'));

alter table public.automation_requests
  add column if not exists details jsonb not null default '{}'::jsonb;
