"use server";

import { redirect } from "next/navigation";

import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

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
