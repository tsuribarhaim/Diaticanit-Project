-- Cleanup for environments that already applied 007 with legacy numeric columns.

alter table if exists public.user_default_items
  drop column if exists calories_kcal,
  drop column if exists protein_g,
  drop column if exists carbs_g,
  drop column if exists fat_g,
  drop column if exists water_ml,
  drop column if exists magnesium_mg,
  drop column if exists potassium_mg,
  drop column if exists iron_mg,
  drop column if exists zinc_mg,
  drop column if exists exercise_met;
