-- A profile version is a copy of the whole user_profile row. 014's trigger saved one on EVERY update - including the
-- app's own activity stamps (last_active_at on almost every page, last_login_at at sign-in), which change nothing the
-- user entered: 412 versions in three days, 42 with a real change. An update that changes only those stamps (and the
-- updated_at they bump) no longer saves a version. Every other change - including the app's own target-review flags -
-- is still versioned. Existing rows are not touched.
create or replace function public.capture_user_profile_version()
returns trigger
language plpgsql
as $$
declare
  next_version int;
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['updated_at', 'last_active_at', 'last_login_at'])
         = (to_jsonb(old) - array['updated_at', 'last_active_at', 'last_login_at']) then
    return new;
  end if;

  update public.user_profile_versions
  set is_active = false,
      updated_at = now()
  where user_id = new.user_id
    and is_active = true;

  select coalesce(max(version_no), 0) + 1
  into next_version
  from public.user_profile_versions
  where user_id = new.user_id;

  insert into public.user_profile_versions (
    user_profile_id,
    user_id,
    version_no,
    is_active,
    snapshot,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.user_id,
    next_version,
    true,
    to_jsonb(new),
    now(),
    now()
  );

  return new;
end;
$$;
