import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Service-role client for the rare server-only checks that must bypass RLS
 * entirely (currently: the pilot allow-list lookup in signUpAction, which
 * runs before the visitor has any session at all, so the usual anon-key
 * createClient() in lib/supabase/server.ts has nothing to authenticate as).
 * Never import this from client code - SUPABASE_SERVICE_ROLE_KEY is
 * intentionally not NEXT_PUBLIC_-prefixed, so this throws instead of
 * silently running with an undefined key if that boundary is ever crossed.
 */
export function createAdminClient() {
  const { supabaseUrl } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable.");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
