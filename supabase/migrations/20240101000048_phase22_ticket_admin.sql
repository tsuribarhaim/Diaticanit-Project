-- Phase 22 follow-up: an admin/support role that can see every user's
-- tickets and change any ticket's status freely, from the same /app/tickets
-- UI a regular user already has (see docs/design/user-support-tickets-design.md
-- for the base design this extends). Granting the role itself stays
-- direct-Supabase-only, same as the rest of this app's admin-adjacent
-- workflows (pilot_allowlist, ticket triage today) - there is deliberately
-- no self-service "make someone an admin" UI.

alter table public.user_profile
  add column is_admin boolean not null default false;

-- security definer + a fixed search_path: this needs to read user_profile
-- regardless of the calling user's own RLS visibility into that table (a
-- plain user's own "select own" policy would otherwise make this always
-- see NULL/false for anyone else, which happens to be harmless here but
-- defeats the purpose) - the standard, narrow way to check a role flag
-- from inside an RLS policy without opening up user_profile itself.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.user_profile where user_id = auth.uid()),
    false
  );
$$;

-- Additive, permissive policies - combined with tickets_select_own and
-- tickets_cancel_own (044) via Postgres's normal OR-of-permissive-policies
-- rule, so a regular user's own access is completely unchanged, and an
-- admin additionally gets everyone's tickets and free status changes on
-- top of their own existing self-service access.
create policy "tickets_select_admin"
on public.tickets
for select
using (public.is_admin());

create policy "tickets_update_admin"
on public.tickets
for update
using (public.is_admin())
with check (public.is_admin());

-- Hardcoded ids (confirmed directly against both projects) rather than
-- name matching - this migration is shared verbatim between dev and
-- staging (see the mirrored supabase/migrations copy), so it lists both
-- environments' ids for Tsuri Bar-Haim and Orit Shenhar together; whichever
-- ids don't exist in a given project simply match zero rows.
update public.user_profile set is_admin = true
where user_id in (
  '493e09ed-aff7-451c-99c5-9fdc35b761d0', -- Tsuri Bar-Haim (dev)
  'a2999c09-c4b0-4f69-82e8-d88d24aa09ff', -- Tsuri Bar-Haim (staging)
  '79d869a9-3a75-41b4-a49c-2c663af8e501', -- Orit Shenhar (dev)
  '66bb2ec7-6319-4fe5-8e80-ae742595955c'  -- Orit Shenhar (staging)
);
