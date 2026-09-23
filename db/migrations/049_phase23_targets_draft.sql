-- Phase 23: durable "pending targets draft" (see docs/design/
-- targets-save-performance-redesign.md's own follow-up on this) - the
-- background full review (runBackgroundTargetsCheck) used to lock in a
-- freshly computed plan automatically the moment it finished. Now it stops
-- one step short: it saves the computed payload here and notifies the
-- user, and only the user's own explicit approval (approveTargetsDraftAction)
-- actually locks it in. This is what lets a user land back on Targets via
-- the notification - at any later time, chat history long gone - and still
-- see exactly what was proposed and why, since it's read straight from here
-- rather than from in-memory chat state that doesn't survive a reload.
--
-- One row per user (not one per request) - a second check completing while
-- an earlier draft is still unreviewed replaces it outright, since only the
-- latest proposal is ever meaningful to act on.
create table public.user_target_profile_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  -- The same user-directed text already used as the AI prompt input (e.g.
  -- "My profile changed (...). Please review...") - presentable as-is when
  -- reconstructing "here's what you asked" on the approval screen, so no
  -- separate summary field is needed.
  goal_text text not null,
  source text not null check (source in ('ai', 'heuristic')),
  -- The full TargetGenerationPayload this would lock in - the diff itself
  -- is computed fresh at display time (against whatever the active plan
  -- still is right then) rather than stored, so it can't go stale relative
  -- to anything else that changed the active plan in the meantime.
  payload jsonb not null,

  created_at timestamptz not null default now()
);

alter table public.user_target_profile_drafts enable row level security;

create policy "targets_drafts_select_own"
on public.user_target_profile_drafts
for select
using (auth.uid() = user_id);

-- Written by runBackgroundTargetsCheck using the same per-request client
-- the triggering /api/targets/chat request already authenticated (still
-- valid inside after(), same request context) - not a service-role client,
-- so this needs its own insert policy rather than relying on RLS bypass.
create policy "targets_drafts_insert_own"
on public.user_target_profile_drafts
for insert
with check (auth.uid() = user_id);

-- Upserting a replacement draft is an update in Postgres terms (on the
-- existing user_id row), not a fresh insert - needs its own policy or a
-- second check completing while the first is unreviewed would fail to
-- save at all.
create policy "targets_drafts_update_own"
on public.user_target_profile_drafts
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Used by both approving (lock in, then delete the draft) and discarding
-- (delete without locking) - see approveTargetsDraftAction/
-- discardTargetsDraftAction.
create policy "targets_drafts_delete_own"
on public.user_target_profile_drafts
for delete
using (auth.uid() = user_id);
