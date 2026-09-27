"use client";

import { formatDateForLocale, formatDateTimeForLocale, formatTimeForLocale, type AppLocale } from "@/lib/locale";
import { useLocalTimeZone } from "@/lib/use-timezone";

/**
 * Drop-in replacements for calling formatTimeForLocale/
 * formatDateTimeForLocale directly inside server-rendered JSX - as client
 * components, these resolve the visitor's real timezone (see
 * useLocalTimeZone) instead of silently formatting in the server's own
 * timezone. Before the first client paint (server render, and the very
 * first hydration frame) these render in UTC - a known, honest placeholder
 * rather than a wrong guess - and correct themselves the instant
 * useLocalTimeZone resolves the real value, with no hydration mismatch
 * (useSyncExternalStore's whole point).
 */
export function LocalTime({ value, locale }: { value: string | Date; locale: AppLocale }) {
  const timeZone = useLocalTimeZone();
  return <>{formatTimeForLocale(value, locale, timeZone)}</>;
}

export function LocalDateTime({ value, locale }: { value: string | Date; locale: AppLocale }) {
  const timeZone = useLocalTimeZone();
  return <>{formatDateTimeForLocale(value, locale, timeZone)}</>;
}

/** Date only, no time-of-day - for a timestamp (not a bare YYYY-MM-DD
 * calendar day, which formatDateForLocale already handles without any
 * timezone conversion). Same hydration-safety reasoning as LocalDateTime/
 * LocalTime above: calling formatDateForLocale directly on a timestamp,
 * without passing a resolved timeZone, silently defaults to the runtime's
 * own local zone - identical on every server render, but potentially a
 * different calendar day than the visitor's own zone, which is exactly a
 * text-content hydration mismatch (confirmed live as React error #418 on
 * the admin ticket list - a "use client" table calling
 * formatDateForLocale(ticket.created_at, locale) with no timeZone arg,
 * rendered once on the server in the server's zone and again on the
 * client in the visitor's own). */
export function LocalDate({ value, locale }: { value: string | Date; locale: AppLocale }) {
  const timeZone = useLocalTimeZone();
  return <>{formatDateForLocale(value, locale, timeZone)}</>;
}
