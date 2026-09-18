"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  // experimental.passkey opts into auth.registerPasskey()/signInWithPasskey()/
  // auth.passkey.* - calling any of those without this flag throws at
  // runtime. Passkey ceremonies (navigator.credentials.create/get) only
  // ever run in the browser, so this only needs to be set here, not on the
  // server client.
  return createBrowserClient(supabaseUrl, supabaseAnonKey, { auth: { experimental: { passkey: true } } });
}
