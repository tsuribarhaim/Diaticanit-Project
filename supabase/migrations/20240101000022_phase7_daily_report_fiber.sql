-- Phase 7 (Daily Report redesign, Phase 1): add fiber tracking so daily
-- totals can be compared against the Targets page's fiber range, matching
-- the other Layer A primary metrics already tracked per report/default.

alter table public.user_daily_reports
  add column if not exists fiber_g numeric(8,2) not null default 0;

alter table public.user_default_items
  add column if not exists fiber_g numeric(8,2) not null default 0;
