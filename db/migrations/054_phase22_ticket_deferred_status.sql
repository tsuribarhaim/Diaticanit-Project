-- Phase 22 follow-up: a "deferred" ticket status, for a real bug that
-- isn't actionable as app code right now (e.g. #1/#11 - Android blocking
-- install, which traces to a platform/OEM security heuristic rather than
-- anything this codebase controls) - distinct from every existing status:
-- not resolved/closed (nothing was fixed), not cancelled (still a real,
-- open concern), just deliberately set aside with a stated reason so it
-- doesn't sit ambiguously as "open" alongside tickets actually being
-- worked. deferred_reason mirrors cancelled_reason's own required-when-
-- that-status check constraint.

alter table public.tickets
  drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (status in (
    'open', 'in_progress', 'resolved', 'closed',
    'cancelled', 'duplicate', 'reopened', 'deferred'
  ));

alter table public.tickets
  add column if not exists deferred_reason text;

alter table public.tickets
  add constraint tickets_deferred_reason_required
  check (status <> 'deferred' or deferred_reason is not null);
