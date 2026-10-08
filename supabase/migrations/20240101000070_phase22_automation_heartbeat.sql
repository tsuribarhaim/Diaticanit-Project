-- Phase 22 follow-up: the Ticket Automation dashboard's status strip (see docs/design/ticket-automation-dashboard.md).
-- The laptop's poller reports the bridge's health once a minute; the dashboard shows "Bridge online / offline" and which
-- run is in progress from these two columns of the single automation_settings row.
alter table public.automation_settings
  add column if not exists bridge_seen_at timestamptz,
  add column if not exists bridge_status jsonb not null default '{}'::jsonb;
