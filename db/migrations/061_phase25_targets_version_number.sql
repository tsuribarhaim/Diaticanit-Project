-- Phase 25 follow-up: a simple, user-facing version counter for
-- user_target_profiles - the user found the notification-only trail
-- "very hard to follow" (which plan did Daffy actually review, which one
-- did she commit) once the async auto-apply redesign meant several
-- notifications could exist with no simple way to tell what changed
-- relative to what. sys_start_date (already on this table, already a
-- real timestamp per row) doubles as "when this version was set" - no
-- separate timestamp column needed.
--
-- Incremented by performTargetsLock on every lock-in (quick-apply or a
-- full review alike), starting at 1 for a user's very first plan. Also
-- doubles as the staleness-guard's own comparison value in
-- runTargetsBackgroundReview (previously the row's opaque id) - simpler,
-- and now directly quotable in a notification ("I reviewed version 4,
-- but your plan is now at version 5").
alter table public.user_target_profiles
  add column if not exists version integer not null default 1;
