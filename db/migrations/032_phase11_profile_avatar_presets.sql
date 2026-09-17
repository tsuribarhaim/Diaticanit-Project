-- Replaces the custom photo-upload avatar (031) with a small curated set of
-- preset icon avatars instead - simpler for the user (pick one, done) and
-- for the app (no file upload, no storage bucket, no image validation to
-- maintain) - "keep it clear and lean" per the request that reversed 031.

-- Dropped first (before the column swap below), not after - the view does
-- `select p.*`, so it depends on avatar_path and blocks dropping that
-- column while it still exists (learned the hard way: this migration
-- originally dropped the view *after* the column and failed outright).
drop view if exists public.user_profile_enriched;

alter table if exists public.user_profile
  add column if not exists avatar_preset text;

alter table if exists public.user_profile
  drop column if exists avatar_path;

-- Refresh view so the column swap above is projected (see 018/029/030/031 -
-- a `select p.*` view freezes its column list at creation time and does not
-- automatically pick up columns added/removed afterward).
create view public.user_profile_enriched as
select
  p.*,
  case
    when p.date_of_birth is not null then date_part('year', age(current_date, p.date_of_birth))::int
    else p.age
  end as calculated_age_years,
  case
    when p.height_cm is not null and p.height_cm > 0 and p.weight_kg is not null then
      round((p.weight_kg / power((p.height_cm / 100.0), 2))::numeric, 2)
    else null
  end as bmi
from public.user_profile p;

-- The avatars storage bucket/policies from 031 are no longer used - remove
-- the RLS policies that only existed to guard writes to it. The bucket
-- itself (empty in practice: no upload ever completed successfully before
-- this feature was reversed) is deliberately left in place rather than
-- dropped here - Supabase blocks direct SQL DELETE against storage.objects
-- *and* storage.buckets ("Direct deletion from storage tables is not
-- allowed" - both have to go through the Storage Management API instead,
-- not a migration). An empty, unused, unreferenced bucket with no policies
-- left is harmless clutter, not a functional problem, so it's not worth a
-- separate out-of-band API call just to tidy it away.
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;
