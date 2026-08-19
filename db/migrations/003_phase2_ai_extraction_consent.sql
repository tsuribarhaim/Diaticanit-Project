-- Phase 2 extension: user acknowledgement for AI-assisted extraction.

create extension if not exists pgcrypto;

create table if not exists public.ai_extraction_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null default 'openai-compatible',
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_extraction_consents_user_id
  on public.ai_extraction_consents(user_id);

create trigger trg_ai_extraction_consents_updated_at
before update on public.ai_extraction_consents
for each row
execute function public.set_updated_at();

alter table public.ai_extraction_consents enable row level security;

create policy "ai_extraction_consents_select_own"
on public.ai_extraction_consents
for select
using (auth.uid() = user_id);

create policy "ai_extraction_consents_insert_own"
on public.ai_extraction_consents
for insert
with check (auth.uid() = user_id);

create policy "ai_extraction_consents_update_own"
on public.ai_extraction_consents
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ai_extraction_consents_delete_own"
on public.ai_extraction_consents
for delete
using (auth.uid() = user_id);
