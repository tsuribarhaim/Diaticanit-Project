-- Phase 18: the AI Coach narrative cache (migration 026) previously
-- invalidated only once per UTC calendar day, so a narrative generated
-- early in the day (e.g. "your protein is very low today") stayed cached
-- and displayed as-is for the rest of that day even after the user logged
-- more food and their actual protein average moved well past that - a real
-- reported mismatch between the (always-live) progress ring and the
-- (stale-cached) coach text.
--
-- inputs_fingerprint stores a short deterministic digest of the same
-- rounded numbers the narrative's own prompt is built from (see
-- buildCoachInputsFingerprint in lib/home-overview.ts) - the cache is now
-- reused only when BOTH the calendar day AND this fingerprint still match
-- today's actual data, so a save in Daily Report that changes what the
-- narrative would actually say invalidates the cache immediately on the
-- next page view, while a page view with nothing new to say still costs no
-- AI call.

alter table if exists public.user_home_coach_narratives
  add column if not exists inputs_fingerprint text not null default '';
