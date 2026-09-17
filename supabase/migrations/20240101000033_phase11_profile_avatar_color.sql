-- Simplifies the avatar further (032's icon presets -> a plain solid-color
-- circle with the user's initial, color chosen from a small palette) - the
-- stored value is now a color id ("teal", "blue", ...), not an icon id, so
-- the column is renamed to match instead of leaving a misleading name.

drop view if exists public.user_profile_enriched;

alter table if exists public.user_profile
  rename column avatar_preset to avatar_color;

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
