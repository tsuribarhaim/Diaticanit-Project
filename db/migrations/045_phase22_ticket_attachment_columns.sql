-- Phase 22 follow-up: the previous migration set up the ticket-attachments
-- storage bucket but never added columns on tickets to actually record
-- which file (if any) belongs to which ticket - caught before any app code
-- was written against it.

alter table public.tickets
  add column attachment_storage_path text,
  add column attachment_file_name text,
  add column attachment_mime_type text,
  add column attachment_file_size_bytes bigint;
