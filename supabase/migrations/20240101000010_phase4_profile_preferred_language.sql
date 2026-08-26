-- Phase 4 profile locale preference for bilingual Hebrew/English UX.

alter table if exists public.user_profile
  add column if not exists preferred_language text not null default 'en'
    check (preferred_language in ('en', 'he'));

update public.user_profile
set preferred_language = 'en'
where preferred_language is null;
