import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { evaluateSessionPolicy } from "@/lib/auth-policy";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { logServerError } from "@/lib/server-log";

export async function middleware(request: NextRequest) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseEnv();
  const response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    logServerError("middleware.auth", "get_user_failed", {
      path: request.nextUrl.pathname,
      error: error.message,
    });
  }

  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/app") && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Idle-timeout / absolute-session-cap enforcement (see lib/auth-policy.ts
  // for the exact thresholds and reasoning) - a Supabase session cookie
  // being merely present and cryptographically valid isn't the same
  // question as whether OUR policy still trusts it. Checked only for /app
  // routes (not every /auth request) since there's nothing to time out on
  // the sign-in/sign-up pages themselves.
  if (pathname.startsWith("/app") && user) {
    const { data: policyRow } = await supabase
      .from("user_profile")
      .select("last_login_at, last_active_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // No profile row yet (e.g. mid-onboarding, before the profile record is
    // created) - nothing to evaluate against, so let the request through
    // rather than locking someone out of finishing their own signup.
    if (policyRow?.last_login_at && policyRow?.last_active_at) {
      const policy = evaluateSessionPolicy({
        lastLoginAt: policyRow.last_login_at,
        lastActiveAt: policyRow.last_active_at,
      });

      if (policy.absoluteExpired || policy.idleExpired) {
        await supabase.auth.signOut();
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/auth/sign-in";
        redirectUrl.search = "";
        redirectUrl.searchParams.set("next", pathname);
        redirectUrl.searchParams.set("reason", "expired");
        return NextResponse.redirect(redirectUrl);
      }

      if (policy.shouldRefreshActivity) {
        await supabase.from("user_profile").update({ last_active_at: new Date().toISOString() }).eq("user_id", user.id);
      }
    }
  }

  if (pathname.startsWith("/auth") && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/app";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // manifest.webmanifest, sw.js, and api/version are deliberately
    // unauthenticated PWA endpoints - a browser fetches them on every visit
    // (sw.js on every foreground re-check, api/version on its own polling
    // interval - see AppUpdateBanner), so without this exclusion every
    // anonymous hit logged a "get_user_failed" error below for a state
    // that's completely expected here, not an actual problem.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
