-- Ticket #2 (Aggregated Tickets): new users should land in dark mode by
-- default rather than light. Only changes the column DEFAULT, which only
-- affects future inserts (new user_profile rows created without an
-- explicit theme_preference, i.e. every onboarding signup) - existing
-- users' already-stored preference is untouched either way.
alter table public.user_profile
  alter column theme_preference set default 'dark';
