-- Phase 16: session lifetime policy (idle timeout + absolute cap, enforced
-- in middleware.ts) and passkey/WebAuthn sign-in support.
--
-- last_login_at marks the start of the current "absolute session" clock -
-- set on every successful password or passkey sign-in. last_active_at marks
-- the idle-timeout clock - refreshed periodically by middleware while the
-- user is actively using the app. Both default to now() so existing users
-- aren't retroactively treated as stale/expired the moment this ships.
--
-- passkey_offer_dismissed tracks whether the user has already been shown
-- (and responded to, either way) the one-time "set up Face ID/Touch ID"
-- prompt after a fresh password login - shown at most once per user, not
-- once per device, since re-showing it on every new device they sign into
-- would be naggy for something they already made a decision about.

alter table if exists public.user_profile
  add column if not exists last_login_at timestamptz not null default now(),
  add column if not exists last_active_at timestamptz not null default now(),
  add column if not exists passkey_offer_dismissed boolean not null default false;
