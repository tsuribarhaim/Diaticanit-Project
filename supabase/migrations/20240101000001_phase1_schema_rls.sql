-- Phase 1 only: user_profile + user_documents + RLS + private storage policy
-- Out of scope in this migration: targets_daily, meal_entries, AI extraction tables/logic

create extension if not exists pgcrypto;

-- Keep updated_at current on updates
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) User profile table
create table if not exists public.user_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  age int not null check (age >= 10 and age <= 120),
  gender text not null,
  height_cm numeric(5,2) not null check (height_cm >= 80 and height_cm <= 250),
  weight_kg numeric(5,2) not null check (weight_kg >= 20 and weight_kg <= 400),
  activity_level text not null check (activity_level in ('sedentary','moderate','active')),
  allergies text[] not null default '{}',
  medical_conditions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_profile_updated_at
before update on public.user_profile
for each row
execute function public.set_updated_at();

-- 2) Uploaded documents registry (metadata only)
create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  storage_path text not null,
  status text not null default 'uploaded' check (status in ('uploaded','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_documents_user_id_created_at
  on public.user_documents (user_id, created_at desc);

create trigger trg_user_documents_updated_at
before update on public.user_documents
for each row
execute function public.set_updated_at();

-- RLS enablement
alter table public.user_profile enable row level security;
alter table public.user_documents enable row level security;

-- RLS policies: users can only access their own rows
create policy "profile_select_own"
on public.user_profile
for select
using (auth.uid() = user_id);

create policy "profile_insert_own"
on public.user_profile
for insert
with check (auth.uid() = user_id);

create policy "profile_update_own"
on public.user_profile
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "profile_delete_own"
on public.user_profile
for delete
using (auth.uid() = user_id);

create policy "documents_select_own"
on public.user_documents
for select
using (auth.uid() = user_id);

create policy "documents_insert_own"
on public.user_documents
for insert
with check (auth.uid() = user_id);

create policy "documents_update_own"
on public.user_documents
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "documents_delete_own"
on public.user_documents
for delete
using (auth.uid() = user_id);

-- Supabase storage setup for private user files
insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do nothing;

-- Storage policies (path convention required):
-- user-documents/<auth.uid()>/<file>
create policy "storage_read_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'user-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'user-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'user-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'user-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);
