"use client";

import { formatDateTimeForLocale, formatTimeForLocale, type AppLocale } from "@/lib/locale";
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
