-- Refresh user_profile_enriched again (same pattern/comment as migration
-- 018): a `select p.*, ...` view freezes its column list at creation time
-- in Postgres - it does NOT automatically pick up columns added to the
-- underlying table afterward. Two columns have been added to user_profile
-- since the view was last refreshed in 018 and were silently missing from
-- it: daily_report_chart_preferences (023) and alcohol_consumption_level
-- (028). Selecting either of those through this view (as
-- apps/web/src/app/app/profile/page.tsx and profile/edit/page.tsx now do
-- for alcohol_consumption_level) fails with an unknown-column error,
-- which those pages treat as "no profile found" and redirect to
-- onboarding - the redirect loop this migration fixes.
--
-- View definition is otherwise unchanged from 018.

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
