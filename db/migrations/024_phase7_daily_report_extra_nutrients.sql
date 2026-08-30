-- Phase 7 (Daily Report redesign): track the remaining nutrients that
-- already have a target range on the Targets page (sodium, added sugar,
-- calcium, vitamin C, vitamin B12, vitamin D, saturated fat, omega-3) so
-- they can be offered as Today's Progress chart options, matching how
-- fiber/magnesium/potassium/iron/zinc are already tracked.

alter table public.user_daily_reports
  add column if not exists sodium_mg numeric(8,2) not null default 0,
  add column if not exists added_sugar_g numeric(8,2) not null default 0,
  add column if not exists calcium_mg numeric(8,2) not null default 0,
  add column if not exists vit_c_mg numeric(8,2) not null default 0,
  add column if not exists vit_b12_mcg numeric(8,2) not null default 0,
  add column if not exists vit_d_mcg numeric(8,2) not null default 0,
  add column if not exists sat_fat_g numeric(8,2) not null default 0,
  add column if not exists omega3_g numeric(8,2) not null default 0;

alter table public.user_default_items
  add column if not exists sodium_mg numeric(8,2) not null default 0,
  add column if not exists added_sugar_g numeric(8,2) not null default 0,
  add column if not exists calcium_mg numeric(8,2) not null default 0,
  add column if not exists vit_c_mg numeric(8,2) not null default 0,
  add column if not exists vit_b12_mcg numeric(8,2) not null default 0,
  add column if not exists vit_d_mcg numeric(8,2) not null default 0,
  add column if not exists sat_fat_g numeric(8,2) not null default 0,
  add column if not exists omega3_g numeric(8,2) not null default 0;
