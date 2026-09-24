-- Phase 22 follow-up: an admin-only "Technical Response" field on tickets -
-- a short plain-language note on what was actually done, for testers to
-- read as a hint of what to expect, without exposing internal detail to
-- non-admins. Deliberately no self-service edit UI in the app, same as
-- fix_description/cancelled_reason - set directly by whoever triages
-- tickets (service-role/direct DB), not through a form.

alter table public.tickets
  add column if not exists technical_response text;
