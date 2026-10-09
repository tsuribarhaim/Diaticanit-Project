-- Phase 26: fix bundles. Tickets whose fixes change the same files are built, tested and promoted as ONE fix, so they never
-- conflict with each other (docs/design/auto-ticket-handling.md, "Fix bundles"; first seen with TCK-117/118/119).
--
-- A bundle is a small group of tickets (up to 4, enforced by the app). The tickets carry the group id in tickets.bundle_id; the
-- night run builds the whole group as one job on one branch, and every member keeps its own fix row pointing at that branch, so
-- the screens that work per ticket keep working. The letter (A, B, ...) is only the label the admin sees; it is reused once a
-- bundle is gone.
--
-- Additive only: one new table and one nullable column. Nothing existing changes, so the code that is live today keeps working
-- after this is applied.

create table if not exists public.automation_bundles (
  id uuid primary key default gen_random_uuid(),
  letter text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.automation_bundles enable row level security;

drop policy if exists "automation_bundles_select_admin" on public.automation_bundles;
create policy "automation_bundles_select_admin"
on public.automation_bundles
for select
using (public.is_admin());

drop policy if exists "automation_bundles_insert_admin" on public.automation_bundles;
create policy "automation_bundles_insert_admin"
on public.automation_bundles
for insert
with check (public.is_admin());

drop policy if exists "automation_bundles_delete_admin" on public.automation_bundles;
create policy "automation_bundles_delete_admin"
on public.automation_bundles
for delete
using (public.is_admin());

alter table public.tickets
  add column if not exists bundle_id uuid references public.automation_bundles(id) on delete set null;

create index if not exists tickets_bundle_idx on public.tickets (bundle_id) where bundle_id is not null;
