-- Lightweight audit trail for "Edit in chat" (as opposed to the inline
-- pencil-icon quantity/nutrient edits, which aren't logged here): every time
-- an existing report is re-saved via the chat conversational edit flow, an
-- entry noting when is appended so there's a record the entry was modified
-- after its original save, without storing a full diff/transcript twice.

alter table if exists public.user_daily_reports
  add column if not exists edit_history jsonb not null default '[]'::jsonb;
