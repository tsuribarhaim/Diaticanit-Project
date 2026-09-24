-- Phase 24 follow-up: ticket #10's agreed redesign - the "Your targets may
-- need an update" popup (targets-stale-modal.tsx) no longer promises an
-- automatic background check that no longer exists in the redesigned
-- Targets page; instead its OK button now just flags the change for later,
-- and Daffy raises it herself the next time the Targets chat is opened
-- (see plan-actions.ts). One pending item per user, not a history table -
-- a newer change while one is still pending replaces it outright, same as
-- the old "only the latest proposal is ever meaningful to act on"
-- reasoning from the drafts table this replaces the spirit of.

alter table public.user_profile
  add column if not exists targets_review_pending boolean not null default false,
  add column if not exists targets_review_changes jsonb,
  add column if not exists targets_review_flagged_at timestamptz;
