-- AI cost per person (agreed 2026-10-19). One row per AI call the app makes for someone - who, which page and feature,
-- the tokens the provider reported and what they cost - written by lib/ai/usage.ts with the service role. Only counts and
-- labels, never prompt or reply text. Admins are recorded too (is_admin = their role at the time of the call); the ticket
-- automation never goes through the app's AI client, so it is not part of this table.
-- Additive only: a new table and a view, nothing existing changes.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- who and where
  user_id uuid references auth.users (id) on delete set null,
  is_admin boolean not null default false,
  page text,
  surface text not null default 'page' check (surface in ('page', 'floating_chat')),
  feature text not null,
  conversation_id uuid,
  locale text,
  -- model and tokens (input_tokens is the uncached part; the four add up to the whole prompt plus the reply)
  provider text not null,
  model text not null,
  provider_request_id text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- cost in USD (null when the model has no price yet; the tokens allow repricing)
  cost_usd numeric(12, 6),
  input_cost_usd numeric(12, 6),
  output_cost_usd numeric(12, 6),
  cache_cost_usd numeric(12, 6),
  price_version text,
  -- outcome and timing
  status text not null default 'ok' check (status in ('ok', 'error', 'timeout')),
  error_code text,
  attempt smallint not null default 1,
  streamed boolean not null default false,
  duration_ms integer,
  first_token_ms integer,
  app_version text
);

create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_page_created_idx on public.ai_usage (page, created_at desc);

alter table public.ai_usage enable row level security;

-- Admins read; nobody writes through the API (the app writes with the service role, which bypasses RLS).
drop policy if exists "ai_usage_select_admin" on public.ai_usage;
create policy "ai_usage_select_admin"
on public.ai_usage
for select
using (public.is_admin());

-- One row per Israel day x person x page x feature x model: what the weekly email and the admin view read.
-- security_invoker keeps the table's admin-only rule in force for whoever queries the view.
create or replace view public.ai_usage_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Asia/Jerusalem')::date as day,
  user_id,
  bool_or(is_admin) as is_admin,
  page,
  surface,
  feature,
  model,
  count(*) as calls,
  count(*) filter (where status <> 'ok') as failed_calls,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(cache_read_tokens) as cache_read_tokens,
  sum(cache_write_tokens) as cache_write_tokens,
  coalesce(sum(cost_usd), 0) as cost_usd,
  count(*) filter (where cost_usd is null and status = 'ok') as unpriced_calls
from public.ai_usage
group by 1, 2, 4, 5, 6, 7;
