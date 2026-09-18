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
}: {
  locale: AppLocale;
  avatarColor?: string | null;
  name?: string | null;
}) {
  const pathname = usePathname();

  if (pathname?.startsWith("/app/onboarding")) {
    return null;
  }

  const tabs: Array<{ href: string; label: string; isActive: boolean; icon: ReactNode }> = [
    {
      href: "/app/profile",
      label: tr(locale, "Profile", "פרופיל"),
      isActive: pathname?.startsWith("/app/profile") ?? false,
      // The user's own picture/initial doubles as this tab's icon - "which
      // account is this" and "go to your profile" are the same destination
      // here, so there's no need for a separate persistent avatar element
      // the way the desktop nav (with its own list of links, not a tab bar)
      // needed one.
      icon: <UserAvatar avatarColor={avatarColor} name={name} className="h-5 w-5 text-[10px]" />,
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
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              tab.isActive ? "text-teal-700 dark:text-teal-400" : "text-slate-500 dark:text-slate-500"
            }`}
          >
            {tab.icon}
            {tab.label}
          </GuardedLink>
        ))}
      </div>
    </nav>
  );
}
