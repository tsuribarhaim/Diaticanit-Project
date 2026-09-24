-- Phase 22 follow-up: multiple attachments per ticket (screenshots pasted
-- directly into the description, plus the existing browse/drag-drop path),
-- replacing the single attachment_* columns on tickets with a proper child
-- table - one row per file, up to MAX_TICKET_ATTACHMENTS (lib/tickets.ts)
-- enforced in the app, not the database (a soft UX cap, not a data
-- integrity rule worth a trigger).

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  created_at timestamptz not null default now()
);

create index idx_ticket_attachments_ticket_id on public.ticket_attachments (ticket_id);

alter table public.ticket_attachments enable row level security;

-- Same visibility as the parent ticket itself (own ticket, or admin) -
-- checked via the parent row rather than duplicating a created_by column
-- here, since a ticket_attachments row has no owner independent of its
-- ticket.
create policy "ticket_attachments_select"
on public.ticket_attachments
for select
using (
  exists (
    select 1 from public.tickets t
    where t.id = ticket_attachments.ticket_id
      and (t.created_by = auth.uid() or public.is_admin())
  )
);

-- Only the ticket's own creator can attach files, and only to their own
-- ticket - matches tickets_insert_own's own scope. No update/delete
-- policy: an attachment is fixed once submitted, same as the ticket
-- content itself has no self-service edit beyond cancelling the whole
-- ticket.
create policy "ticket_attachments_insert_own"
on public.ticket_attachments
for insert
with check (
  exists (
    select 1 from public.tickets t
    where t.id = ticket_attachments.ticket_id
      and t.created_by = auth.uid()
  )
);

-- Backfill: every ticket that already has a single legacy attachment gets
-- one row here before the old columns are dropped below.
insert into public.ticket_attachments (ticket_id, storage_path, file_name, mime_type, file_size_bytes, created_at)
select id, attachment_storage_path, attachment_file_name, attachment_mime_type, attachment_file_size_bytes, created_at
from public.tickets
where attachment_storage_path is not null;

alter table public.tickets
  drop column attachment_storage_path,
  drop column attachment_file_name,
  drop column attachment_mime_type,
  drop column attachment_file_size_bytes;

-- The original storage read policy (044) only let a user read their own
-- folder - correct for a plain user, but it also silently blocked an
-- admin from generating a signed URL for someone else's attachment even
-- though tickets_select_admin already lets them see the ticket row itself.
-- Caught while extending this area for multi-attachment support; fixed
-- here since it's the same policy multi-attachment already needs to touch.
drop policy if exists "ticket_attachments_read_own" on storage.objects;

create policy "ticket_attachments_read_own_or_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'ticket-attachments'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
