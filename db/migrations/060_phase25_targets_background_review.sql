-- Phase 25: async, auto-apply targets review (replaces the manual-approval
-- design from migrations 049/050, which itself turned out to have been
-- fully superseded by a later redesign - api/targets/chat/route.ts,
-- runBackgroundTargetsCheck, and user_target_profile_drafts were all dead
-- code with no live caller by the time this was found).
--
-- One row per user (not a history table) - tracks which negotiation
-- request is the CURRENT one for that user, written the instant a request
-- that needs full AI review is accepted (before the background job even
-- starts) and checked again right before the background job locks
-- anything in. If a newer request has replaced this row in the meantime,
-- the older job's own result is silently discarded instead of overwriting
-- a more recent change - fixes a real race the old drafts-table design
-- never guarded against (whichever background check happened to finish
-- LAST won, regardless of which request was actually most recent).
create table public.user_target_update_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null default gen_random_uuid(),
  goal_text text not null,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.user_target_update_requests enable row level security;

create policy "targets_update_requests_select_own"
on public.user_target_update_requests
for select
using (auth.uid() = user_id);

-- Written by negotiateActiveTargetsAction using the caller's own
-- per-request client (not service-role) - needs its own insert/update
-- policies, same reasoning as the drafts table this replaces.
create policy "targets_update_requests_insert_own"
on public.user_target_update_requests
for insert
with check (auth.uid() = user_id);

-- Upserting a replacement request is an update (on the existing user_id
-- row), not a fresh insert - needs its own policy. Also used by
-- runTargetsBackgroundReview (still the same request-scoped client,
-- valid inside after() - see the old drafts table's own comment on why)
-- to flip status to 'complete'/'failed' once done.
create policy "targets_update_requests_update_own"
on public.user_target_update_requests
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- The old manual-approval drafts table this replaces - confirmed dead
-- (no live caller anywhere in the app) before dropping.
drop table if exists public.user_target_profile_drafts;
