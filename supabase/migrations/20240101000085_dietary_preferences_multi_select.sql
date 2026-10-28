-- TCK-165: dietary preference becomes multi-select (e.g. Standard + Kosher). A new dietary_preferences text[] column holds the
-- full list, any combination of the same 6 options, or none.
--
-- Additive only, so the code that is live today keeps working after it is applied: no dropped column, no changed constraint.
-- The old single dietary_preference column and its check stay as they are, and the app keeps writing one main value into it
-- (priority Low-Carb/Keto > Vegan > Vegetarian > Gluten-Free > Kosher > Standard), so targets, the AI prompts and the targets
-- review flag keep working unchanged. Each user's current choice is copied into the new list.
--
-- The view is refreshed in the same file, same pattern and reason as 016, 018, 029, 073 and 074: `select p.*, ...` freezes its
-- column list when it is created, the profile pages read through it, and selecting a column it does not have fails there, which
-- those pages treat as "no profile found" (redirect to onboarding, the loop 029 fixed). The definition is otherwise identical to 074.

alter table public.user_profile add column if not exists dietary_preferences text[] not null default '{}';

update public.user_profile
set dietary_preferences = array[dietary_preference]
where dietary_preference is not null and dietary_preferences = '{}';

alter table public.user_profile drop constraint if exists user_profile_dietary_preferences_check;
alter table public.user_profile add constraint user_profile_dietary_preferences_check
  check (dietary_preferences <@ array['standard', 'vegetarian', 'vegan', 'low_carb_keto', 'kosher', 'gluten_free']::text[]);

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
