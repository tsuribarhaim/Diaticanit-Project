-- Refresh user_profile_enriched after 072 (TCK-118), same pattern and reason as 016, 018 and 029: a `select p.*, ...` view freezes
-- its column list when it is created, so the three health_goals columns added to user_profile in 072 are missing from it. The
-- profile pages read through this view, and a select of an unknown column fails there - which those pages treat as "no profile
-- found" and redirect to onboarding (the redirect loop 029 fixed). This must therefore be applied before any code that selects
-- health_goals / health_goals_markers_details / health_goals_other_details from the view. It also picks up has_allergies (051),
-- which was likewise missing.
--
-- The view definition is otherwise identical to 033.

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
