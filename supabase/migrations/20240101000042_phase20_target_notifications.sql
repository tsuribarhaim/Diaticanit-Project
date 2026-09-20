-- Phase 20: Targets save-flow redesign (see
-- docs/design/targets-save-performance-redesign.md) - the background full
-- plan check can now surface a concern without blocking the fast save, and
-- this table is how that concern reaches the user afterward.
--
-- field_keys is a jsonb array of the RingMetric-style ids the concern is
-- about (e.g. ["protein_min_g","protein_max_g"] or ["customTarget_<id>"]),
-- not just free text - this is what lets the Targets/Home rings look up
-- "is this specific value currently flagged?" and show the warning icon
-- next to it, not just a generic unread badge.
create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_profile_id uuid references public.user_target_profiles(id) on delete cascade,

  severity text not null default 'concern'
    check (severity in ('info', 'concern')),
  message text not null,
  field_keys jsonb not null default '[]'::jsonb,

  -- Deliberately separate from "resolved" (see the design doc's own
  -- decision on this): opening the notification only marks it read, it
  -- does not clear the warning icon on the flagged field - only a later
  -- background check that no longer finds the issue does that, via
  -- resolved_at. Forces an actual decision, not just an acknowledgment.
  read_at timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now()
);

create index idx_user_notifications_user_unresolved
  on public.user_notifications (user_id, created_at desc)
  where resolved_at is null;

alter table public.user_notifications enable row level security;

create policy "user_notifications_select_own"
on public.user_notifications
for select
using (auth.uid() = user_id);

create policy "user_notifications_insert_own"
on public.user_notifications
for insert
with check (auth.uid() = user_id);

create policy "user_notifications_update_own"
on public.user_notifications
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
