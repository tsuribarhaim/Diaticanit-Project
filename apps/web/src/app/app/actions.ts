"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

const LOCALE_COOKIE = "phc_locale";

/**
 * Marks the one-time "set up Face ID/Touch ID" prompt (see
 * PasskeyEnrollPrompt) as answered - called whether the user actually
 * enrolled a passkey or clicked "Not now", either way stopping it from
 * showing again. Adding a passkey later, or on another device, still works
 * fine afterward through the always-available Settings row (see
 * PasskeyManager) - this only ever gates the one unsolicited prompt.
 */
export async function dismissPasskeyOfferAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const { error } = await supabase.from("user_profile").update({ passkey_offer_dismissed: true }).eq("user_id", user.id);

  if (error) {
    logServerError("app.dismissPasskeyOffer", "update_failed", {
      userId: user.id,
      error: error.message,
    });
  }
}

// No cookie here unlike updateLocaleAction below - that cookie exists so the
// sign-in page (rendered before any authenticated DB read is possible) can
// still greet a returning user in their own language. Theme only ever
// applies within /app/* (see ProtectedAppLayout's own comment on why), which
// already does one authenticated user_profile read per page load regardless
// - there's no pre-auth screen that needs a faster, DB-free signal here.
export async function updateThemeAction(theme: "light" | "dark") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { error } = await supabase
    .from("user_profile")
    .update({ theme_preference: theme })
    .eq("user_id", user.id);

  if (error) {
    logServerError("app.updateTheme", "update_failed", {
      userId: user.id,
      error: error.message,
    });
    return;
  }

  revalidatePath("/app", "layout");
}

export async function updateLocaleAction(locale: "en" | "he") {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { error } = await supabase
    .from("user_profile")
    .update({ preferred_language: locale })
    .eq("user_id", user.id);

  if (error) {
    logServerError("app.updateLocale", "update_failed", {
      userId: user.id,
      error: error.message,
    });
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}

export async function signOutAction() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    logServerError("auth.signOut", "supabase_sign_out_failed", {
      error: error.message,
    });
  }

  redirect("/auth/sign-in");
}
