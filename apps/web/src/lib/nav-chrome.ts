import { unstable_cache, updateTag } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

const NAV_CHROME_CACHE_TAG = "nav-chrome";

export type NavChromeData = {
  profile: {
    preferred_language: string | null;
    first_name: string | null;
    avatar_color?: string | null;
    theme_preference?: string | null;
  } | null;
  profileError: { message: string } | null;
  unresolvedNotificationCount: number;
};

/**
 * The shared app layout (see app/app/layout.tsx) re-runs this same read on
 * every single page navigation, since every page under /app is
 * force-dynamic - name/avatar/theme/notification-count rarely change
 * between one tap and the next, so a few seconds of staleness costs nothing
 * while saving a full extra Supabase round-trip on every nav. Deliberately
 * NOT the per-request cookie-scoped createClient() here - unstable_cache's
 * whole point is reuse ACROSS requests, and a cookie-bound client isn't
 * something that's safe or meaningful to reuse that way. createAdminClient()
 * (service role, bypasses RLS) is used instead, same as the one other
 * pre-auth-context use of it in this app (signUpAction's allow-list check) -
 * safe here because the caller has already authenticated userId via
 * getAuthenticatedUser() before this is ever invoked, and every query below
 * is explicitly scoped to that one userId.
 *
 * revalidate: 10s bounds the absolute worst-case staleness (e.g. an
 * unresolved-notification count that changed via some background process
 * with nothing else revalidating this tag). Anything the user themselves
 * changes - name, avatar color, theme, language - is expected to show up
 * immediately instead of waiting out that window, which is what
 * revalidateNavChrome() below is for; call it from every action that writes
 * one of those fields.
 */
const getCachedNavChrome = unstable_cache(
  async (userId: string): Promise<NavChromeData> => {
    const supabase = createAdminClient();

    const [fullSelect, notificationCountResult] = await Promise.all([
      supabase
        .from("user_profile")
        .select("preferred_language, first_name, avatar_color, theme_preference")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("user_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("resolved_at", null),
    ]);

    let profile: NavChromeData["profile"] = fullSelect.data;
    if (fullSelect.error?.message.includes("avatar_color") || fullSelect.error?.message.includes("theme_preference")) {
      profile = (
        await supabase.from("user_profile").select("preferred_language, first_name").eq("user_id", userId).maybeSingle()
      ).data;
    }

    return {
      profile,
      profileError: fullSelect.error ? { message: fullSelect.error.message } : null,
      unresolvedNotificationCount: notificationCountResult.count ?? 0,
    };
  },
  ["nav-chrome"],
  { revalidate: 10, tags: [NAV_CHROME_CACHE_TAG] },
);

export function getNavChrome(userId: string): Promise<NavChromeData> {
  return getCachedNavChrome(userId);
}

/** Call from any server action that writes user_profile.first_name,
 * avatar_color, theme_preference, or preferred_language (or that resolves a
 * notification) - see getNavChrome's own comment for why this can't rely on
 * revalidatePath alone. updateTag (not revalidateTag) specifically: it
 * expires the tag immediately and only works inside a Server Action - the
 * exact "read your own writes right after this action returns" behavior
 * every caller here needs, whereas revalidateTag's second argument controls
 * a longer-lived cache-life profile, meant for revalidating from outside an
 * action (e.g. a webhook or route handler). Deliberately one shared tag
 * rather than a per-user one: this app's traffic is small enough (a pilot,
 * not a public product) that invalidating every user's cached nav chrome
 * whenever any one user edits their own is negligible overhead, and it
 * avoids the fragility of threading a dynamic per-user tag through
 * unstable_cache's static tags option. */
export function revalidateNavChrome() {
  updateTag(NAV_CHROME_CACHE_TAG);
}
