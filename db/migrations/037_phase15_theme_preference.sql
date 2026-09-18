-- Phase 15: user-selectable light/dark theme preference, same shape as
-- preferred_language (migration 010) - a plain column read on every /app/*
-- page load to set the theme attribute for the whole authenticated app area.

alter table if exists public.user_profile
  add column if not exists theme_preference text not null default 'light'
    check (theme_preference in ('light', 'dark'));

update public.user_profile
set theme_preference = 'light'
where theme_preference is null;
