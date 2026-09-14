import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

import { getSupabaseEnv } from "@/lib/supabase/env";

export async function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll can be called from a Server Component, where mutating
          // cookies is not available. Middleware keeps auth cookies in sync.
        }
      },
    },
  });
}

/**
 * `supabase.auth.getUser()` revalidates the session with a network call to
 * Supabase Auth every time it's invoked, and every layout/page/component in
 * a single request tree calls it independently to get the current user.
 * Wrapping it in React's `cache()` memoizes that call per request (not
 * across requests/users - a fresh cache is created for every render), so a
 * page load that previously fired 2-3 of these network calls in sequence
 * now fires it once and reuses the result.
 */
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
