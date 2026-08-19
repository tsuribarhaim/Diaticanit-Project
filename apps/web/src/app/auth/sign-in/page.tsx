import { cookies } from "next/headers";

import { SignInForm } from "@/components/sign-in-form";
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
  searchParams: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();

  const locale = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  const recentEmails = parseRecentEmailsCookie(cookieStore.get(RECENT_SIGNIN_EMAILS_COOKIE)?.value);
  const nextPath = sanitizeNextPath(resolvedSearchParams.next);

  return <SignInForm locale={locale} nextPath={nextPath} recentEmails={recentEmails} />;
}
