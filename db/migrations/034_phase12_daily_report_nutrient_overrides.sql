-- Lets a user directly correct a report's own nutrient totals (e.g. the
-- calorie count printed on a food package) without that number getting
-- silently overwritten the next time an item on the same report is
-- edited/deleted and totals get recalculated from items. A field's key is
-- present (true) here once the user has manually set it directly - absent
-- means "still automatically derived from this report's own items", the
-- default/original behavior for every existing row.

alter table if exists public.user_daily_reports
  add column if not exists nutrient_overrides jsonb not null default '{}'::jsonb;
