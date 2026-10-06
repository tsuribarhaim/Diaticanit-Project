-- Phase 22 follow-up: spec-first Auto Ticket Handling (see docs/design/auto-ticket-handling.md).
-- Two more auto_handle values, so a ticket can be prepared and approved BEFORE the night run:
--   'S' - admin asked for a spec (an analyst should investigate and propose)
--   'A' - a proposal is written (in auto_handle_notes) and awaits the admin's approval
-- Existing values are unchanged: 'Y' queued for the night run, 'P' attempted/needs a human,
-- 'D' fix committed on a local branch. NULL still means "not opted in".
alter table public.tickets
  drop constraint if exists tickets_auto_handle_check;

alter table public.tickets
  add constraint tickets_auto_handle_check
  check (auto_handle in ('Y', 'P', 'D', 'S', 'A'));
