-- Phase 22 follow-up: the daily admin digest shows "since yesterday" next to every ticket number,
-- so each digest remembers the numbers it reported. One row per calendar day (Israel time); a
-- re-run on the same day overwrites that day's row. Service-role only: RLS is on with no
-- policies, so nobody can read or write it through the public API.
create table if not exists public.daily_digest_snapshots (
  snapshot_date date primary key,
  counts jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.daily_digest_snapshots enable row level security;
