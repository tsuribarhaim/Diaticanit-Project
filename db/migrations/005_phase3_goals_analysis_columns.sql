-- Phase 3 goals extension: persist multi-goal analysis fields.

alter table public.user_goals
  add column if not exists detected_goals text[] not null default '{}',
  add column if not exists blood_balance_focus boolean not null default false,
  add column if not exists sleep_focus boolean not null default false,
  add column if not exists analysis_source text not null default 'heuristic'
    check (analysis_source in ('heuristic','ai'));
