-- Phase 6 follow-up: store the target-relevant profile fields at the moment
-- targets are locked, so the Targets page can detect when the live profile
-- has drifted from what the locked plan was actually generated for (e.g. a
-- newly recorded medical condition) and prompt the user to recalculate.

alter table public.user_target_profiles
  add column profile_snapshot jsonb not null default '{}'::jsonb;
