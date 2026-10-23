-- Phrases that mean "an earlier day" in a Daily report chat message (agreed 2026-10-23, TCK-69 cost fix). The chat sends
-- the user's last 3 days of food only when a message contains one of these (lib/ai/recall-phrases.ts), instead of on
-- every message. Reference data: add a phrase (or switch one off) with a row here - the app picks it up within 5
-- minutes, no deploy. Matching is "contains", case-insensitive, Hebrew vowel marks ignored, so a phrase also matches
-- inside a longer word ("אתמול" matches "מאתמול").
-- Additive only: a new table, nothing existing changes.

create table if not exists public.chat_recall_phrases (
  id uuid primary key default gen_random_uuid(),
  phrase text not null unique,
  locale text not null default 'any' check (locale in ('he', 'en', 'any')),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

alter table public.chat_recall_phrases enable row level security;

-- Admins read and manage the list; the app reads it with the service role.
drop policy if exists "chat_recall_phrases_admin_all" on public.chat_recall_phrases;
create policy "chat_recall_phrases_admin_all"
on public.chat_recall_phrases
for all
using (public.is_admin())
with check (public.is_admin());

insert into public.chat_recall_phrases (phrase, locale, note) values
  ('אתמול', 'he', 'yesterday (also matches מאתמול, כמו אתמול)'),
  ('שלשום', 'he', 'the day before yesterday'),
  ('שאריות', 'he', 'leftovers'),
  ('שארית', 'he', 'leftover'),
  ('שנשאר', 'he', 'what was left'),
  ('עוד מנה', 'he', 'another portion'),
  ('מנה נוספת', 'he', 'another portion'),
  ('עוד פעם', 'he', 'again'),
  ('שוב', 'he', 'again'),
  ('אותו דבר', 'he', 'the same thing'),
  ('אותה מנה', 'he', 'the same dish'),
  ('כמו ב', 'he', 'like on / like at (כמו ביום ראשון, כמו בצהריים אתמול)'),
  ('יום ראשון', 'he', 'Sunday (ביום ראשון, מיום ראשון)'),
  ('יום שני', 'he', 'Monday'),
  ('יום שלישי', 'he', 'Tuesday'),
  ('יום רביעי', 'he', 'Wednesday'),
  ('יום חמישי', 'he', 'Thursday'),
  ('יום שישי', 'he', 'Friday'),
  ('בשבת', 'he', 'on Saturday'),
  ('משבת', 'he', 'from Saturday'),
  ('yesterday', 'en', null),
  ('leftover', 'en', 'also matches leftovers'),
  ('same as', 'en', null),
  ('another portion', 'en', null),
  ('another serving', 'en', null),
  ('again', 'en', null),
  ('the day before', 'en', null),
  ('last night', 'en', null),
  ('sunday', 'en', null),
  ('monday', 'en', null),
  ('tuesday', 'en', null),
  ('wednesday', 'en', null),
  ('thursday', 'en', null),
  ('friday', 'en', null),
  ('saturday', 'en', null)
on conflict (phrase) do nothing;
