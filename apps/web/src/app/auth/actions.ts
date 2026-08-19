"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logServerError } from "@/lib/server-log";
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

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    logServerError("auth.signUp", "supabase_sign_up_failed", {
      email: parsed.data.email,
      error: error.message,
    });
    return { error: error.message };
  }

  if (data.session) {
    redirect("/app");
  }

  return {
    success:
      "Account created. Check your email if confirmation is enabled, then sign in.",
  };
}
