import { cookies } from "next/headers";

import { SignInForm } from "@/components/sign-in-form";
import { getEnvironmentBadgeLabel } from "@/lib/environment-badge";
import { normalizeLocale } from "@/lib/locale";

const RECENT_SIGNIN_EMAILS_COOKIE = "phc_recent_signin_emails";
const LOCALE_COOKIE = "phc_locale";

function sanitizeNextPath(nextPath: string | undefined): string {
  if (!nextPath) return "/app";
  if (!nextPath.startsWith("/app")) return "/app";
  return nextPath;
}

function parseRecentEmailsCookie(value: string | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 5);
  } catch {
    return [];
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();

  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const recentEmails = parseRecentEmailsCookie(cookieStore.get(RECENT_SIGNIN_EMAILS_COOKIE)?.value);
  const nextPath = sanitizeNextPath(resolvedSearchParams.next);
  const environmentBadgeLabel = getEnvironmentBadgeLabel();

  return (
    <SignInForm
      locale={locale}
      nextPath={nextPath}
      recentEmails={recentEmails}
      environmentBadgeLabel={environmentBadgeLabel}
      // Set by middleware.ts when it signs the user out itself, after the
      // idle-timeout or absolute-session-cap policy elapsed (see
      // lib/auth-policy.ts) - distinguishes "you were signed out for a
      // policy reason" from a plain first-time/never-logged-in visit, which
      // would otherwise look identical (both just land here with no user).
      sessionExpired={resolvedSearchParams.reason === "expired"}
    />
  );
}
