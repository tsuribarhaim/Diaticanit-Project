"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

const LOCALE_COOKIE = "phc_locale";

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
