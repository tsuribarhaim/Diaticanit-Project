-- Phase 19: invite-only pilot gate.
-- Sign-up is rejected server-side (signUpAction in app/auth/actions.ts) for
-- any email not present here. RLS is enabled with no policies at all, so
-- anon/authenticated roles get zero access by default - only the
-- service-role key (used server-side via lib/supabase/admin.ts) can read
-- this table, keeping the tester list private even though Supabase's REST
-- API is otherwise reachable directly by anyone with the anon key. Seed
-- rows are inserted separately, outside of version control, matching this
-- project's existing convention of keeping tester/personal data out of git.
create table if not exists public.pilot_allowlist (
  email text primary key,
  name text,
  invited_at timestamptz not null default now(),
  notes text
);

comment on table public.pilot_allowlist is
  'Invite-only gate for the PWA pilot - sign-up is rejected for any email not listed here. Checked server-side with the service-role key only, never exposed to anon/public read.';

alter table public.pilot_allowlist enable row level security;
