/**
 * Local-timezone day-bucketing helpers (ticket #31: Daily Report wasn't
 * using the user's local timezone - every "today"/day-range boundary was
 * computed in server/UTC time, so a report near midnight could land on
 * the wrong calendar day for anyone far from UTC). The user's IANA zone
 * (e.g. "Asia/Jerusalem") is captured client-side and stored on
 * user_profile.timezone - see components/timezone-sync.tsx - and every
 * site that used to bucket by UTC calendar day should use these instead.
 */

/** Used whenever a user's timezone hasn't been captured yet (brand new
 * session before the client-side sync effect has run, or an account that
 * predates this feature and hasn't loaded a page since) - matches the
 * previous UTC-only behavior exactly, so this is a strict improvement
 * (correct once captured) with no worse fallback than before. */
export const DEFAULT_TIMEZONE = "UTC";

/** Converts a "wall clock" date+time (no offset, e.g. "2026-09-24T00:00:00")
 * as understood in `timeZone` into the real UTC instant it represents.
 * There's no direct Intl API for this, so it uses the standard technique of
 * formatting the same instant in both the target zone and UTC and
 * correcting for the difference - accurate across DST transitions, unlike
 * naively adding a fixed offset. */
function zonedWallTimeToUtc(wallTimeIso: string, timeZone: string): Date {
  const asIfUtc = new Date(`${wallTimeIso}Z`);
  const tzString = asIfUtc.toLocaleString("en-US", { timeZone });
  const utcString = asIfUtc.toLocaleString("en-US", { timeZone: "UTC" });
  const offsetMs = new Date(utcString).getTime() - new Date(tzString).getTime();
  return new Date(asIfUtc.getTime() + offsetMs);
}

/** Pure calendar-date arithmetic (Y/M/D components only, not a real
 * instant) - safe to use for "the next/previous calendar date string"
 * regardless of DST, since it never represents a moment in time. */
export function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The calendar date (YYYY-MM-DD) `referenceDate` falls on on in `timeZone` -
 * "today" as the user themselves would say it, not the server's UTC date. */
export function getLocalDateString(timeZone: string, referenceDate: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(referenceDate);
}

/** The [start, end) UTC instant range covering local midnight-to-midnight
 * of `dateString` in `timeZone` - the day-bucketing boundary every Daily
 * Report/Home query should filter report_at against, in place of the old
 * `Date.UTC(...)`-based UTC-midnight boundary. */
export function getLocalDayRangeUtc(dateString: string, timeZone: string): { startIso: string; endIso: string } {
  const start = zonedWallTimeToUtc(`${dateString}T00:00:00`, timeZone);
  const end = zonedWallTimeToUtc(`${addDaysToDateString(dateString, 1)}T00:00:00`, timeZone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Convenience for the extremely common "today, in this timezone" case. */
export function getTodayLocalDayRangeUtc(timeZone: string): { startIso: string; endIso: string } {
  return getLocalDayRangeUtc(getLocalDateString(timeZone), timeZone);
}
