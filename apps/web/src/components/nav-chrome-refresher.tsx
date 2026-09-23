"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Renders nothing - just keeps the shared layout's own nav-chrome data (see
 * app/app/layout.tsx and lib/nav-chrome.ts), in particular the notification
 * badge, from going stale while the user just sits on one screen without
 * navigating anywhere. Without this, the badge only ever refreshes as a
 * side effect of a real navigation (a <Link> tap, a server action's own
 * router.refresh()) - reported directly as intermittent: it worked the
 * first time (a navigation happened to follow shortly after the
 * notification was created) and not the next (the user stayed put on one
 * page instead).
 *
 * Deliberately NOT the same per-check polling approach already rejected
 * for the Targets chat itself (see targets-chat-workspace.tsx's own
 * history with that) - this isn't tied to any specific in-flight check,
 * doesn't touch page content, and only ever refreshes this shared layout
 * shell, which is a small, cheap, cached (10s TTL - see nav-chrome.ts)
 * read either way.
 */
export function NavChromeRefresher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Onboarding is a transient, single-purpose wizard whose own page
    // (app/onboarding/page.tsx) does a server-side redirect("/app") once
    // the profile is saved and an active target profile already exists -
    // true for anyone re-testing an already-onboarded account. A
    // background router.refresh() landing mid-wizard re-runs that
    // redirect check and can silently kick the user out of the wizard
    // right as they finish a step, discarding client state with no error
    // shown (confirmed live: the profile-save fetch completed
    // successfully, but the next thing that happened was a navigation to
    // /app - a router.refresh()-triggered redirect, not a crash). Nothing
    // on this route depends on nav-chrome staying fresh in the background
    // the way a page the user sits on for a while does.
    if (pathname?.startsWith("/app/onboarding")) return;

    const intervalId = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [router, pathname]);

  return null;
}
