-- Phase 8 (Home dashboard uplift, Release 6): caches the AI Coach's
-- generated narrative per user/range/locale so the Home page doesn't call
-- the AI provider on every page load - the narrative is regenerated at
-- most once per UTC calendar day (or immediately if the user's locale
-- changes), and reused for the rest of that day.
create table if not exists public.user_home_coach_narratives (
  user_id uuid not null references auth.users(id) on delete cascade,
  range text not null check (range in ('today','7','30','90')),
  locale text not null,
  narrative_text text not null,
  generated_for_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, range, locale)
);

alter table public.user_home_coach_narratives enable row level security;

create policy "user_home_coach_narratives_select_own"
on public.user_home_coach_narratives
for select
using (auth.uid() = user_id);

create policy "user_home_coach_narratives_insert_own"
on public.user_home_coach_narratives
for insert
with check (auth.uid() = user_id);

create policy "user_home_coach_narratives_update_own"
on public.user_home_coach_narratives
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_home_coach_narratives_delete_own"
on public.user_home_coach_narratives
for delete
using (auth.uid() = user_id);
