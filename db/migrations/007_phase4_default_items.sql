-- Phase 4 defaults: reusable user-defined logging defaults for daily reports.

create extension if not exists pgcrypto;

create table if not exists public.user_default_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null default 'food'
    check (kind in ('food','hydration','exercise','custom')),
  default_quantity numeric(8,2) not null default 1,
  default_unit text not null default 'unit',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_default_items_user_id_created_at
  on public.user_default_items(user_id, created_at desc);

create trigger trg_user_default_items_updated_at
before update on public.user_default_items
for each row
execute function public.set_updated_at();

alter table public.user_default_items enable row level security;

create policy "user_default_items_select_own"
on public.user_default_items
for select
using (auth.uid() = user_id);

create policy "user_default_items_insert_own"
on public.user_default_items
for insert
with check (auth.uid() = user_id);

create policy "user_default_items_update_own"
on public.user_default_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_default_items_delete_own"
on public.user_default_items
for delete
using (auth.uid() = user_id);
