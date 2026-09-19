"use server";

import { cookies } from "next/headers";
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

function sanitizeNextPath(nextPath: string | null): string {
  if (!nextPath) return "/app";
  if (!nextPath.startsWith("/app")) return "/app";
  return nextPath;
}

/**
 * Starts both session-policy clocks fresh (see lib/auth-policy.ts) - called
 * for every kind of "the user just proved who they are" event: a password
 * sign-in, an auto-signed-in signup, and a passkey sign-in (see
 * recordLoginAction below, called client-side right after
 * supabase.auth.signInWithPasskey() succeeds, since that ceremony happens
 * entirely in the browser with no server action of its own to hook into
 * directly). A passkey ceremony is at least as strong a proof of identity
 * as a password, so it resets the absolute-session clock the same way.
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
 * Client-side passkey sign-in (supabase.auth.signInWithPasskey()) has no
 * form submission of its own to hang this on - the sign-in form calls this
 * right after that ceremony succeeds, using the session cookies it just
 * established to identify who to record the login for.
 */
export async function recordLoginAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await markSuccessfulLogin(supabase, user.id);
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
    await markSuccessfulLogin(supabase, data.user.id);
    redirect("/app");
  }

  return {
    success:
      "Account created. Check your email if confirmation is enabled, then sign in.",
  };
}
