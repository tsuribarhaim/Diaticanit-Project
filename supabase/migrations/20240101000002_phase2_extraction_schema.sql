-- Phase 2 schema foundations: extraction reports, extracted components,
-- component reference ranges, and user confirmations.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Extend user_documents with extraction processing state
alter table public.user_documents
  add column if not exists extraction_status text not null default 'not_started'
    check (extraction_status in ('not_started','queued','processing','extracted','needs_review','failed')),
  add column if not exists extraction_error text,
  add column if not exists extraction_last_run_at timestamptz;

-- 1) Extracted report header
create table if not exists public.extracted_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.user_documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','extracted','needs_review','failed','confirmed')),
  extraction_confidence numeric(5,4) check (extraction_confidence >= 0 and extraction_confidence <= 1),
  parser_version text,
  source_file_name text,
  summary_overall_status text not null default 'unknown'
    check (summary_overall_status in ('stable','attention','critical','unknown')),
  summary_bullets text[] not null default '{}',
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_extracted_reports_user_id_created_at
  on public.extracted_reports(user_id, created_at desc);

create index if not exists idx_extracted_reports_document_id
  on public.extracted_reports(document_id);

create trigger trg_extracted_reports_updated_at
before update on public.extracted_reports
for each row
execute function public.set_updated_at();

-- 2) Extracted report components
create table if not exists public.extracted_components (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.extracted_reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  component_code text,
  component_name text not null,
  measured_value numeric,
  measured_value_text text,
  unit text,
  reference_min numeric,
  reference_max numeric,
  reference_text text,
  status text not null default 'unknown'
    check (status in ('red','yellow','green','unknown')),
  confidence numeric(5,4) check (confidence >= 0 and confidence <= 1),
  observed_at timestamptz,
  source_line text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_extracted_components_report_id
  on public.extracted_components(report_id);

create index if not exists idx_extracted_components_user_id_category
  on public.extracted_components(user_id, category);

create trigger trg_extracted_components_updated_at
before update on public.extracted_components
for each row
execute function public.set_updated_at();

-- 3) Global reference ranges
create table if not exists public.component_reference_ranges (
  id uuid primary key default gen_random_uuid(),
  component_name text not null,
  unit text,
  sex text,
  age_min int,
  age_max int,
  reference_min numeric,
  reference_max numeric,
  source_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_component_reference_ranges_component_name
  on public.component_reference_ranges(component_name);

create trigger trg_component_reference_ranges_updated_at
before update on public.component_reference_ranges
for each row
execute function public.set_updated_at();

-- 4) User-confirmed components
create table if not exists public.user_confirmed_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid not null references public.extracted_reports(id) on delete cascade,
  component_id uuid not null references public.extracted_components(id) on delete cascade,
  confirmed_value_numeric numeric,
  confirmed_value_text text,
  unit text,
  confirmed_status text not null default 'unknown'
    check (confirmed_status in ('red','yellow','green','unknown')),
  note text,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, component_id)
);

create index if not exists idx_user_confirmed_components_user_id_confirmed_at
  on public.user_confirmed_components(user_id, confirmed_at desc);

create trigger trg_user_confirmed_components_updated_at
before update on public.user_confirmed_components
for each row
execute function public.set_updated_at();

-- RLS enablement
alter table public.extracted_reports enable row level security;
alter table public.extracted_components enable row level security;
alter table public.component_reference_ranges enable row level security;
alter table public.user_confirmed_components enable row level security;

-- extracted_reports policies
create policy "extracted_reports_select_own"
on public.extracted_reports
for select
using (auth.uid() = user_id);

create policy "extracted_reports_insert_own"
on public.extracted_reports
for insert
with check (auth.uid() = user_id);

create policy "extracted_reports_update_own"
on public.extracted_reports
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "extracted_reports_delete_own"
on public.extracted_reports
for delete
using (auth.uid() = user_id);

-- extracted_components policies
create policy "extracted_components_select_own"
on public.extracted_components
for select
using (auth.uid() = user_id);

create policy "extracted_components_insert_own"
on public.extracted_components
for insert
with check (auth.uid() = user_id);

create policy "extracted_components_update_own"
on public.extracted_components
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "extracted_components_delete_own"
on public.extracted_components
for delete
using (auth.uid() = user_id);

-- user_confirmed_components policies
create policy "confirmed_components_select_own"
on public.user_confirmed_components
for select
using (auth.uid() = user_id);

create policy "confirmed_components_insert_own"
on public.user_confirmed_components
for insert
with check (auth.uid() = user_id);

create policy "confirmed_components_update_own"
on public.user_confirmed_components
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "confirmed_components_delete_own"
on public.user_confirmed_components
for delete
using (auth.uid() = user_id);

-- component_reference_ranges policies
create policy "component_reference_ranges_select_authenticated"
on public.component_reference_ranges
for select
to authenticated
using (true);
