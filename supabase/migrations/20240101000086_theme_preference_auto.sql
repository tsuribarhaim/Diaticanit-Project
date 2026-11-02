-- TCK-175: theme_preference gains a third value, 'auto' (follow the phone's light/dark setting), next to 'light' and 'dark'.
-- New users default to 'auto'. Existing rows are left untouched, so everyone who already has 'light' or 'dark' keeps it.
--
-- Migration 037 created the CHECK inline (unnamed), so it is looked up through pg_constraint rather than dropped by a
-- hard-coded name. No column is added, so user_profile_enriched does not need to be recreated.
-- Must be applied before the TCK-175 code is deployed: saving 'auto' fails the old CHECK.

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where contype = 'c'
      and conrelid = 'public.user_profile'::regclass
      and pg_get_constraintdef(oid) ilike '%theme_preference%'
  loop
    execute 'alter table public.user_profile drop constraint ' || quote_ident(c.conname);
  end loop;
end $$;

alter table public.user_profile add constraint user_profile_theme_preference_check check (theme_preference in ('auto', 'light', 'dark'));

alter table public.user_profile alter column theme_preference set default 'auto';
