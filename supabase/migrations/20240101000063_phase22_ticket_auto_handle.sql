-- Phase 22 follow-up: Auto Ticket Handling via n8n (see
-- docs/design/auto-ticket-handling.md) - an admin-only opt-in flag that
-- marks a ticket eligible for an unattended Claude Code pass, plus a new
-- status for "Claude fixed and tested this on dev, waiting on you to test
-- and promote it" that deliberately stops short of "resolved".

alter table public.tickets
  drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (status in (
    'draft', 'open', 'in_progress', 'fixed', 'resolved', 'closed',
    'cancelled', 'duplicate', 'reopened', 'deferred'
  ));

-- 'Y'/'P'/'D' only - "not opted in" is just NULL (there's no separate 'N'
-- value; collapsing the admin's own "N or NULL, same meaning" into one
-- representation avoids two different ways to mean the same off-state).
-- No dedicated RLS policy needed: tickets_update_admin (048) already grants
-- admins free-column update access, and no self-service policy grants a
-- plain user general field access at all (same protection
-- technical_response/fix_description already rely on - see 056's own
-- comment), so this is already exactly as protected as those.
alter table public.tickets
  add column if not exists auto_handle text check (auto_handle in ('Y', 'P', 'D')),
  add column if not exists auto_handle_notes text;
