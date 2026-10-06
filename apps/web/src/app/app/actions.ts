"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { revalidateNavChrome } from "@/lib/nav-chrome";
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

/**
 * Captures the browser's own IANA timezone onto the user's profile
 * (ticket #31) - there's no reliable server-side way to know a user's real
 * timezone, so this is called once client-side (see components/
 * timezone-sync.tsx) whenever it differs from what's already stored,
 * which covers both a brand-new account and an existing one that predates
 * this column, plus self-corrects if the user genuinely travels to a new
 * zone. Every day-bucketing site falls back to UTC (lib/timezone.ts's
 * DEFAULT_TIMEZONE) until this has run at least once.
 */
export async function setUserTimezoneAction(timezone: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  // Intl throws on a malformed zone name rather than silently accepting
  // one - cheap way to reject garbage before it reaches the database,
  // since this value ultimately comes from the client.
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return;
  }

  const { error } = await supabase.from("user_profile").update({ timezone }).eq("user_id", user.id);

  if (error) {
    logServerError("app.setUserTimezone", "update_failed", {
      userId: user.id,
      error: error.message,
    });
    return;
  }

  revalidatePath("/app", "layout");
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

  revalidateNavChrome();
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

  revalidateNavChrome();
  revalidatePath("/app", "layout");
}

export type ChangePasswordState = {
  error?: string;
  success?: string;
};

async function resolveUserLocale(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from("user_profile")
    .select("preferred_language")
    .eq("user_id", userId)
    .maybeSingle();
  return normalizeLocale(data?.preferred_language);
}

function changePasswordSchema(locale: AppLocale) {
  return z.object({
    currentPassword: z.string().min(1, tr(locale, "Enter your current password.", "יש להזין את הסיסמה הנוכחית.")),
    newPassword: z.string().min(8, tr(locale, "New password must be at least 8 characters.", "הסיסמה החדשה חייבת להכיל לפחות 8 תווים.")),
  });
}

/**
 * For an already-signed-in user (Settings -> Password, Profile -> Change
 * password), unlike the sign-in
 * page's own forgot-password flow - no email round trip needed since
 * they're already authenticated. Still re-verifies the CURRENT password
 * first (via a second signInWithPassword call, using the session's own
 * email) rather than letting an open session change the password outright -
 * a stolen/left-open session shouldn't be enough on its own to lock the
 * real owner out.
 */
export async function changePasswordAction(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/auth/sign-in");
  }

  // Resolved while the session is still live - the success path below
  // signs the user out.
  const locale = await resolveUserLocale(supabase, user.id);

  const parsed = changePasswordSchema(locale).safeParse({
    currentPassword: formData.get("current_password"),
    newPassword: formData.get("new_password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? tr(locale, "Invalid password payload.", "נתוני הסיסמה אינם תקינים.") };
  }

  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (reauthError) {
    logServerError("app.changePassword", "reauth_failed", { userId: user.id, error: reauthError.message });
    return { error: tr(locale, "Current password is incorrect.", "הסיסמה הנוכחית שגויה.") };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.newPassword });

  if (updateError) {
    logServerError("app.changePassword", "update_failed", { userId: user.id, error: updateError.message });
    if (updateError.code === "same_password") {
      return { error: tr(locale, "New password must be different from the current one.", "הסיסמה החדשה חייבת להיות שונה מהנוכחית.") };
    }
    if (updateError.code === "weak_password") {
      return { error: tr(locale, "New password is too weak. Choose a stronger one.", "הסיסמה החדשה חלשה מדי. בחרו סיסמה חזקה יותר.") };
    }
    return { error: tr(locale, "Couldn't update the password. Please try again.", "לא ניתן היה לעדכן את הסיסמה. נסו שוב.") };
  }

  // Sign out so the user proves the new password works right away (sign-in
  // shows a matching notice via reason=password_changed).
  const { error: signOutError } = await supabase.auth.signOut();

  if (signOutError) {
    logServerError("app.changePassword", "sign_out_failed", { userId: user.id, error: signOutError.message });
  }

  redirect("/auth/sign-in?reason=password_changed");
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
