-- Profile picture: an optional avatar the user uploads once on the Profile
-- page and that then appears in the nav on every page, falling back to a
-- colored initial-letter circle when none is set (rendered client-side from
-- first_name - no column needed for the fallback itself).

alter table if exists public.user_profile
  add column if not exists avatar_path text;

-- Refresh view so the newly added column is projected (see 018/029/030 - a
-- `select p.*` view freezes its column list at creation time and does not
-- automatically pick up columns added afterward).
drop view if exists public.user_profile_enriched;

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

-- Public bucket (unlike user-documents, which is private) - the avatar has
-- to render cheaply in the nav on every single page load, which means a
-- plain public URL rather than generating a signed URL server-side on every
-- request. A profile picture isn't sensitive the way medical documents are,
-- so the public-read tradeoff is fine here.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Storage policies (path convention required): avatars/<auth.uid()>/<file>
-- No read policy needed - the bucket is public, so downloads/public URLs
-- bypass RLS entirely; only mutating your own folder needs to be enforced.
create policy "avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
