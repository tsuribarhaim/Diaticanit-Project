-- Phase 25: per-user IANA timezone (ticket #31) - Daily Report's "today"/
-- day-range bucketing has always used the server's UTC calendar day, which
-- doesn't line up with local midnight for any user far from UTC. Nullable:
-- captured client-side on first page load after this ships (see
-- components/timezone-sync.tsx) rather than backfilled, since the app has
-- no reliable server-side way to know a user's real timezone until their
-- own browser reports it; every call site reading this column falls back
-- to UTC (lib/timezone.ts's DEFAULT_TIMEZONE) when it's still null, which
-- is exactly the previous behavior, not a regression.

alter table public.user_profile
  add column if not exists timezone text;
