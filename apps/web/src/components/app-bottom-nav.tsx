"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { GuardedLink } from "@/components/unsaved-preview-context";
import { UserAvatar } from "@/components/user-avatar";
import { tr, type AppLocale } from "@/lib/locale";

const CONFIRM_MESSAGE_EN = "You have an unsaved conversation or generated target plan on the Targets page that hasn't been locked in yet. Leave this page anyway?";
const CONFIRM_MESSAGE_HE = "יש לך שיחה או תכנית יעדים שנוצרה בדף היעדים שטרם ננעלה. לעזוב את הדף בכל זאת?";

/**
 * The mobile counterpart to AppNav - below the `sm` breakpoint this replaces
 * the top nav bar entirely (see app-nav.tsx's own `hidden sm:block`) with a
 * fixed bottom tab bar covering only the 3 daily-use destinations. "Manage
 * Saved List", "Settings", and "Sign out" don't fit a tab bar and don't get
 * their own tab - they live inside the Profile page instead, so Profile
 * remains the one place that's always reachable on mobile.
 */
export function AppBottomNav({
  locale,
  avatarColor,
  name,
  notificationCount,
}: {
  locale: AppLocale;
  avatarColor?: string | null;
  name?: string | null;
  /** The one gap this tab bar had until now: AppNav's own notification
   * badge (see that file) only ever rendered in the desktop top nav -
   * `hidden sm:block` on AppNav means mobile had NO notification signal
   * anywhere at all, confirmed directly in testing ("I don't see it on the
   * phone in any place"). A small dot on the Profile tab (where the
   * always-available Notifications row lives - see app/profile/page.tsx)
   * is this bar's own equivalent, sized for a tab icon rather than
   * repeating AppNav's full pill+count treatment. */
  notificationCount?: number;
}) {
  const pathname = usePathname();

  if (pathname?.startsWith("/app/onboarding")) {
    return null;
  }

  const tabs: Array<{ href: string; label: string; isActive: boolean; icon: ReactNode }> = [
    {
      // TCK-96 round 2: this tab used to redirect to Notifications instead
      // of Profile whenever there was a pending notification - meant as a
      // helpful shortcut, but for a "concern"-severity notification (see
      // nav-chrome.ts's own comment) the badge count only ever clears once
      // a LATER background check confirms the underlying issue is actually
      // fixed, not when the user views it - so for an affected account the
      // redirect could never turn off at all. Confirmed live as "stuck on
      // notifications no matter how many times I try, even after
      // reinstalling" - the earlier one-tap "escape hatch while already on
      // Notifications" fix only ever addressed the second tap, never the
      // first. Matches the desktop AppNav's own Profile link (app-nav.tsx),
      // which has never redirected - the red dot below is the only signal
      // now; the Profile page's own always-visible Notifications row is the
      // deliberate way in, same as it always was on desktop.
      href: "/app/profile",
      label: tr(locale, "Profile", "פרופיל"),
      isActive: (pathname?.startsWith("/app/profile") || pathname?.startsWith("/app/notifications")) ?? false,
      // The user's own picture/initial doubles as this tab's icon - "which
      // account is this" and "go to your profile" are the same destination
      // here, so there's no need for a separate persistent avatar element
      // the way the desktop nav (with its own list of links, not a tab bar)
      // needed one.
      icon: (
        <span className="relative inline-flex">
          <UserAvatar avatarColor={avatarColor} name={name} className="h-5 w-5 text-[10px]" />
          {notificationCount ? (
            <span
              aria-hidden="true"
              className="absolute -end-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-white bg-rose-600 dark:border-slate-900"
            />
          ) : null}
        </span>
      ),
    },
    {
      href: "/app/targets",
      label: tr(locale, "Targets", "יעדים"),
      isActive: pathname?.startsWith("/app/targets") ?? false,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      ),
    },
    {
      href: "/app/daily-report",
      label: tr(locale, "Daily Report", "דיווח יומי"),
      isActive: pathname === "/app/daily-report",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M9 12h6M9 16h6M9 8h2" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white sm:hidden dark:border-slate-800 dark:bg-slate-900"
      aria-label={tr(locale, "Primary", "ניווט ראשי")}
    >
      <div className="mx-auto flex max-w-6xl items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map((tab) => (
          <GuardedLink
            key={tab.href}
            href={tab.href}
            confirmMessage={tr(locale, CONFIRM_MESSAGE_EN, CONFIRM_MESSAGE_HE)}
            // TCK-107: flex-col lived on THIS link, but GuardedLink renders
            // its children through PendingOverlay (nav-link.tsx), which
            // wraps them in one plain, unstyled <span> - the link's own
            // flex-col has only that single span to "stack", so it does
            // nothing. Targets/Daily Report only ever looked stacked by
            // accident: their icon+label combined width happens to exceed
            // this tab's own share of a narrow screen, so the label text
            // wraps onto its own line same as any overflowing inline
            // content would. Profile's short label fits next to its
            // (wider) avatar icon on one line, so it never "accidentally"
            // wrapped - reported live as the icon sitting beside the text
            // instead of above it. The real fix is an explicit inner
            // wrapper that stacks icon+label on purpose, regardless of
            // PendingOverlay's own span or how wide any given label is -
            // this also makes Targets/Daily Report's stacking reliable
            // instead of lucky, not just Profile's.
            className={`flex flex-1 items-center justify-center py-2 text-[11px] font-medium ${
              tab.isActive ? "text-teal-700 dark:text-teal-400" : "text-slate-500 dark:text-slate-500"
            }`}
          >
            <span className="flex flex-col items-center gap-0.5">
              {tab.icon}
              {tab.label}
            </span>
          </GuardedLink>
        ))}
      </div>
    </nav>
  );
}
