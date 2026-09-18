import { Spinner } from "@/components/spinner";

/**
 * Route-transition feedback for every page under /app/* - without this,
 * clicking a nav link (Profile/Targets/Daily Report/etc.) left the old page
 * on screen with no visual change at all while the new route's server data
 * loaded, which reads as "did my tap even register?" on a phone especially.
 * Next.js shows this automatically (via a Suspense boundary around
 * layout.tsx's {children}) the moment a navigation's destination segment
 * suspends on its own data fetching, and swaps back to the real page the
 * instant it's ready - no client-side wiring needed. AppNav/AppBottomNav
 * live outside {children} in layout.tsx, so they stay in place throughout;
 * only the content area shows this. No locale is available this early in
 * the render (this file can't do its own data fetching without itself
 * becoming the slow thing users are waiting on), so this stays a plain,
 * language-neutral spinner rather than page-specific copy.
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center py-16">
      <Spinner className="h-9 w-9 animate-spin text-teal-700 dark:text-teal-400" />
      <span className="sr-only">Loading… טוען…</span>
    </div>
  );
}
