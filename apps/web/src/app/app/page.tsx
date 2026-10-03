import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * TCK-22: Daily Report is the default landing destination everywhere now
 * (sign-in, sign-up, the PWA manifest's start_url, the already-signed-in-
 * visits-/auth guard), and nothing in the app's own nav links here any
 * more. The one path that still reaches this page is a home-screen icon
 * added BEFORE that change: Android/iOS bake a PWA's start_url into the
 * OS-level launch config at install time and don't reliably re-read it
 * from a later manifest update, so an already-installed icon keeps
 * launching straight to "/app" - with a valid session cookie already in
 * hand, bypassing the sign-in redirect entirely (confirmed live: reported
 * as "the version says 1.1.37 but it landed on the old page"). Redirecting
 * here, rather than relying on every affected user to manually remove and
 * re-add their icon, is what actually closes that gap.
 *
 * The former Home dashboard this page used to render (Today/7/30/90-day
 * progress rings, exercise ring, AI Coach card) was already unreachable
 * via any in-app link before this change - its data layer
 * (lib/home-overview.ts) is unaffected and still powers the Targets page's
 * own Overview view.
 */
export default function AppHomePage() {
  redirect("/app/daily-report");
}
