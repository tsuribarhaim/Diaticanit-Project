"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const authSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export type AuthActionState = {
  error?: string;
  success?: string;
};

const RECENT_SIGNIN_EMAILS_COOKIE = "phc_recent_signin_emails";
const MAX_RECENT_SIGNIN_EMAILS = 5;
const LOCALE_COOKIE = "phc_locale";
const INSTALL_PROMPT_COOKIE = "phc_prompt_install";

function normalizeLocaleCookieValue(value: unknown): "en" | "he" {
  return value === "he" ? "he" : "en";
}

async function persistRecentSignInEmail(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;

  const cookieStore = await cookies();
  const existingRaw = cookieStore.get(RECENT_SIGNIN_EMAILS_COOKIE)?.value;

  let existingEmails: string[] = [];
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (Array.isArray(parsed)) {
        existingEmails = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      existingEmails = [];
    }
  }

  const nextEmails = [normalizedEmail, ...existingEmails.filter((value) => value !== normalizedEmail)].slice(
    0,
    MAX_RECENT_SIGNIN_EMAILS,
  );

  cookieStore.set(RECENT_SIGNIN_EMAILS_COOKIE, JSON.stringify(nextEmails), {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 180,
  });
}

async function persistLocalePreference(locale: "en" | "he"): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * A brand-new tester who never sees an install prompt just reads as "this
 * PWA thing didn't work" - InstallAppPrompt's own cooldown/dismissal logic
 * is right for ordinary browsing, but the very first successful login is
 * the one moment worth overriding that for. Readable (not httpOnly) since
 * InstallAppPrompt (a client component) is what actually consumes and
 * clears it - see that component's own comment. Short-lived because it
 * only needs to survive the redirect straight into the one page load right
 * after login.
 */
async function markInstallPromptDue(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(INSTALL_PROMPT_COOKIE, "1", {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
  });
}

async function isFirstLogin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  const { data } = await supabase.from("user_profile").select("last_login_at").eq("user_id", userId).maybeSingle();
  return !data?.last_login_at;
}

function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return "/app";
  if (!nextPath.startsWith("/app")) return "/app";
  return nextPath;
}

/**
 * Starts both session-policy clocks fresh (see lib/auth-policy.ts) - called
 * for every kind of "the user just proved who they are" event: a password
 * sign-in, an auto-signed-in signup, and a passkey sign-in (see
 * completePasskeySignInAction below). A passkey ceremony is at least as
 * strong a proof of identity as a password, so it resets the
 * absolute-session clock the same way.
 */
async function markSuccessfulLogin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("user_profile")
    .update({ last_login_at: now, last_active_at: now })
    .eq("user_id", userId);

  if (error) {
    logServerError("auth.markSuccessfulLogin", "update_failed", { userId, error: error.message });
  }
}

/**
 * Client-side passkey sign-in (supabase.auth.signInWithPasskey()) only ever
 * establishes the session via a client-side cookie write - there's no
 * server request/response cycle of its own for that to ride along with, the
 * way the password flow below gets one for free. Confirmed live in
 * production that this is a real race, not a theoretical one: the ceremony
 * succeeds, but the client's own immediate follow-up navigation to /app can
 * outrace that cookie write being visible to the very next request, and
 * middleware bounces it straight back to sign-in since it sees no session
 * yet - to the user this looks exactly like the sign-in hanging, when
 * reloading the same page a moment later shows them already signed in.
 *
 * Passing the access/refresh token pair the client just received into a
 * server action - and having setSession establish the session HERE, inside
 * a real request/response cycle - closes that race: by the time this
 * awaited call resolves on the client, the Set-Cookie header it carried has
 * already been applied, so the navigation that follows can't outrace it
 * anymore.
 */
export async function completePasskeySignInAction(
  accessToken: string,
  refreshToken: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error || !data.user) {
    logServerError("auth.completePasskeySignIn", "set_session_failed", { error: error?.message });
    return { error: error?.message ?? "Could not complete sign-in." };
  }

  await markSuccessfulLogin(supabase, data.user.id);
  return {};
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = authSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    logServerError("auth.signIn", "validation_failed", {
      issues: parsed.error.issues,
    });
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid sign-in payload.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    logServerError("auth.signIn", "supabase_sign_in_failed", {
      email: parsed.data.email,
      error: error.message,
    });
    return { error: error.message };
  }

  await persistRecentSignInEmail(parsed.data.email);

  const userId = data.user?.id;
  if (userId) {
    const { data: profile } = await supabase
      .from("user_profile")
      .select("preferred_language")
      .eq("user_id", userId)
      .maybeSingle();

    await persistLocalePreference(normalizeLocaleCookieValue(profile?.preferred_language));
    if (await isFirstLogin(supabase, userId)) {
      await markInstallPromptDue();
    }
    await markSuccessfulLogin(supabase, userId);
  }

  const nextPath = sanitizeNextPath(formData.get("next")?.toString() ?? null);
  redirect(nextPath);
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = authSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    logServerError("auth.signUp", "validation_failed", {
      issues: parsed.error.issues,
    });
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid sign-up payload.",
    };
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  // Invite-only pilot gate (db/migrations/041) - can be lifted later without
  // a code change by setting PILOT_ALLOWLIST_ENABLED=false, once the app is
  // ready for open sign-up. Checked with the service-role client since this
  // runs before the visitor has any session for the usual anon-key client
  // to authenticate as, and the allow-list table has no anon-readable RLS
  // policy at all (see that migration's own comment).
  if (process.env.PILOT_ALLOWLIST_ENABLED !== "false") {
    const admin = createAdminClient();
    const { data: allowListEntry, error: allowListError } = await admin
      .from("pilot_allowlist")
      .select("email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (allowListError) {
      logServerError("auth.signUp", "allowlist_check_failed", { error: allowListError.message });
      return { error: "Something went wrong. Please try again in a moment." };
    }

    if (!allowListEntry) {
      logServerError("auth.signUp", "allowlist_rejected", { email: normalizedEmail });
      return {
        error: "This is a private pilot and your email isn't on the invite list yet. Contact the team if you believe this is a mistake.",
      };
    }
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    logServerError("auth.signUp", "supabase_sign_up_failed", {
      email: parsed.data.email,
      error: error.message,
    });
    return { error: error.message };
  }

  if (data.session && data.user) {
    // Always a first login by definition (the account was just created this
    // request), so no isFirstLogin check needed here unlike signInAction.
    await markInstallPromptDue();
    await markSuccessfulLogin(supabase, data.user.id);
    redirect("/app");
  }

  return {
    success:
      "Account created. Check your email if confirmation is enabled, then sign in.",
  };
}

const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address."),
});

/**
 * Always returns the same success message regardless of whether the email
 * actually belongs to an account - confirming/denying that in the response
 * would let anyone probe which emails are registered. Supabase's own
 * resetPasswordForEmail already behaves this way (no error for an unknown
 * email), so this just mirrors that at the UI layer for a genuine
 * validation failure (a malformed email) too.
 */
export async function forgotPasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  const genericSuccess = {
    success:
      "If that email has an account, a password reset link is on its way. Check your inbox (and spam folder).",
  };

  if (!parsed.success) {
    // Still the generic message, not the validation error - see this
    // function's own comment on why literal email-existence/validity isn't
    // distinguished in the response.
    return genericSuccess;
  }

  const supabase = await createClient();
  const headerList = await headers();
  // Derived from the incoming request rather than a hardcoded env var, so
  // this resolves correctly whichever of dev/staging/the Vercel pilot the
  // request actually came in on, with nothing to keep in sync between them.
  const origin = headerList.get("origin") ?? `https://${headerList.get("host")}`;

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/reset-password`,
  });

  if (error) {
    logServerError("auth.forgotPassword", "reset_email_failed", {
      email: parsed.data.email,
      error: error.message,
    });
  }

  return genericSuccess;
}
