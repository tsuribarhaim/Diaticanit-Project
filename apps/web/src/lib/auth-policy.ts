/**
 * Session lifetime policy, enforced in middleware.ts - two independent
 * clocks, both counted in days and overridable via env vars so dev/staging
 * can use shorter values for testing without a code change:
 *
 * - Idle timeout (default 30 days): how long a session stays valid with NO
 *   activity at all. Resets on every request while the user is actively
 *   using the app - closing the tab or the browser doesn't affect it, only
 *   elapsed real time with zero visits does.
 * - Absolute cap (default 90 days): a hard ceiling on how long a session
 *   can be trusted, counted from the last time the user actually typed
 *   their password or completed a passkey ceremony - even a daily user
 *   still needs to prove who they are again once this elapses, bounding
 *   how long a stolen/leaked device token stays useful regardless of how
 *   "active" it looks.
 *
 * Both are read fresh on every call rather than cached at module load, so a
 * changed env var takes effect on the next deploy/restart without needing
 * anything else to change.
 */

const DEFAULT_IDLE_TIMEOUT_DAYS = 30;
const DEFAULT_ABSOLUTE_SESSION_DAYS = 90;

function readPositiveIntDays(envValue: string | undefined, fallback: number): number {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getIdleTimeoutDays(): number {
  return readPositiveIntDays(process.env.AUTH_IDLE_TIMEOUT_DAYS, DEFAULT_IDLE_TIMEOUT_DAYS);
}

export function getAbsoluteSessionDays(): number {
  return readPositiveIntDays(process.env.AUTH_ABSOLUTE_SESSION_DAYS, DEFAULT_ABSOLUTE_SESSION_DAYS);
}

function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

/**
 * How stale last_active_at is allowed to get before middleware bothers
 * writing a fresh value - the idle-timeout check itself always reads the
 * true last-known value on every request, this only throttles how often we
 * write an update for it, since a Postgres write on literally every /app/*
 * request would be wasteful when "active 40 seconds ago" and "active now"
 * make no practical difference to a 30-day idle window.
 */
const ACTIVITY_WRITE_THROTTLE_MS = 15 * 60 * 1000;

export type SessionPolicyCheck = {
  /** True if the absolute session cap has elapsed since last_login_at. */
  absoluteExpired: boolean;
  /** True if the idle timeout has elapsed since last_active_at. */
  idleExpired: boolean;
  /** True if last_active_at is stale enough to be worth refreshing. */
  shouldRefreshActivity: boolean;
};

export function evaluateSessionPolicy({
  lastLoginAt,
  lastActiveAt,
  now = new Date(),
}: {
  lastLoginAt: string | Date;
  lastActiveAt: string | Date;
  now?: Date;
}): SessionPolicyCheck {
  const nowMs = now.getTime();
  const lastLoginMs = new Date(lastLoginAt).getTime();
  const lastActiveMs = new Date(lastActiveAt).getTime();

  return {
    absoluteExpired: nowMs - lastLoginMs > daysToMs(getAbsoluteSessionDays()),
    idleExpired: nowMs - lastActiveMs > daysToMs(getIdleTimeoutDays()),
    shouldRefreshActivity: nowMs - lastActiveMs > ACTIVITY_WRITE_THROTTLE_MS,
  };
}
