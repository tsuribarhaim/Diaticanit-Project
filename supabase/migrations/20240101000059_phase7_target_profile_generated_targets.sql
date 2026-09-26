-- Phase 7 follow-up (TCK-24): a single absolute target number per nutrient,
-- alongside the existing min/max validation band - not maintained by
-- application code (which would need every write path to remember to keep
-- it in sync with min/max, a real risk already seen elsewhere in this
-- session), but a Postgres GENERATED column: always exactly
-- round((min+max)/2), recomputed automatically by the database on every
-- write, impossible to drift out of sync. Integer, per the user's own
-- "whole numbers, no decimal point" requirement. min/max stay exactly as
-- they are today - still the only thing actually written, still what
-- validates a user's direct target edit - this just adds a read-only
-- derived column on top for anything (the AI chat's own prompt context
-- first) that wants the single number without recomputing it itself.

alter table public.user_target_profiles
  add column if not exists calories_target integer generated always as (round((calories_min + calories_max) / 2)::integer) stored,
  add column if not exists protein_target_g integer generated always as (round((protein_min_g + protein_max_g) / 2)::integer) stored,
  add column if not exists carbs_target_g integer generated always as (round((carbs_min_g + carbs_max_g) / 2)::integer) stored,
  add column if not exists fats_target_g integer generated always as (round((fats_min_g + fats_max_g) / 2)::integer) stored,
  add column if not exists fiber_target_g integer generated always as (round((fiber_min_g + fiber_max_g) / 2)::integer) stored,
  add column if not exists sodium_target_mg integer generated always as (round((sodium_min_mg + sodium_max_mg) / 2)::integer) stored,
  add column if not exists added_sugar_target_g integer generated always as (round((added_sugar_min_g + added_sugar_max_g) / 2)::integer) stored,
  add column if not exists water_target_ml integer generated always as (round((water_min_ml + water_max_ml) / 2)::integer) stored,
  add column if not exists potassium_target_mg integer generated always as (round((potassium_min_mg + potassium_max_mg) / 2)::integer) stored,
  add column if not exists magnesium_target_mg integer generated always as (round((magnesium_min_mg + magnesium_max_mg) / 2)::integer) stored,
  add column if not exists calcium_target_mg integer generated always as (round((calcium_min_mg + calcium_max_mg) / 2)::integer) stored,
  add column if not exists iron_target_mg integer generated always as (round((iron_min_mg + iron_max_mg) / 2)::integer) stored,
  add column if not exists zinc_target_mg integer generated always as (round((zinc_min_mg + zinc_max_mg) / 2)::integer) stored,
  add column if not exists vit_c_target_mg integer generated always as (round((vit_c_min_mg + vit_c_max_mg) / 2)::integer) stored,
  add column if not exists vit_b12_target_mcg integer generated always as (round((vit_b12_min_mcg + vit_b12_max_mcg) / 2)::integer) stored,
  add column if not exists vit_d_target_mcg integer generated always as (round((vit_d_min_mcg + vit_d_max_mcg) / 2)::integer) stored,
  add column if not exists sat_fat_target_g integer generated always as (round((sat_fat_min_g + sat_fat_max_g) / 2)::integer) stored,
  add column if not exists omega3_target_g integer generated always as (round((omega3_min_g + omega3_max_g) / 2)::integer) stored,
  add column if not exists cholesterol_target_mg integer generated always as (round((cholesterol_min_mg + cholesterol_max_mg) / 2)::integer) stored;
