-- Phase 4 defaults cache: persist parsed metrics per default item for reuse.

alter table if exists public.user_default_items
  add column if not exists parse_mode text not null default 'heuristic'
    check (parse_mode in ('heuristic','ai')),
  add column if not exists parser_version text not null default 'daily-heuristic-v1',
  add column if not exists parse_confidence numeric(5,4) not null default 0
    check (parse_confidence >= 0 and parse_confidence <= 1),
  add column if not exists calories_kcal numeric(8,2) not null default 0,
  add column if not exists protein_g numeric(8,2) not null default 0,
  add column if not exists carbs_g numeric(8,2) not null default 0,
  add column if not exists fat_g numeric(8,2) not null default 0,
  add column if not exists water_ml numeric(8,2) not null default 0,
  add column if not exists magnesium_mg numeric(8,2) not null default 0,
  add column if not exists potassium_mg numeric(8,2) not null default 0,
  add column if not exists iron_mg numeric(8,2) not null default 0,
  add column if not exists zinc_mg numeric(8,2) not null default 0,
  add column if not exists exercise_minutes int not null default 0,
  add column if not exists estimated_burn_kcal numeric(8,2) not null default 0;
