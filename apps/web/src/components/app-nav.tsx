"use client";

import { usePathname } from "next/navigation";

import { signOutAction } from "@/app/app/actions";
import { GuardedLink } from "@/components/unsaved-preview-context";
import { UserAvatar } from "@/components/user-avatar";
import { tr, type AppLocale } from "@/lib/locale";

const CONFIRM_MESSAGE_EN = "You have an unsaved conversation or generated target plan on the Targets page that hasn't been locked in yet. Leave this page anyway?";
const CONFIRM_MESSAGE_HE = "יש לך שיחה או תכנית יעדים שנוצרה בדף היעדים שטרם ננעלה. לעזוב את הדף בכל זאת?";

export function AppNav({
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

  const navItems: Array<{ href: string; label: string; isActive: boolean }> = [
    { href: "/app", label: tr(locale, "Home", "בית"), isActive: pathname === "/app" },
    { href: "/app/profile", label: tr(locale, "Profile", "פרופיל"), isActive: pathname?.startsWith("/app/profile") ?? false },
    { href: "/app/targets", label: tr(locale, "Targets", "יעדים"), isActive: pathname?.startsWith("/app/targets") ?? false },
    {
      href: "/app/daily-report",
      label: tr(locale, "Daily Report", "דיווח יומי"),
      isActive: pathname === "/app/daily-report",
    },
    {
      href: "/app/daily-report/defaults",
      label: tr(locale, "Manage Saved List", "ניהול רשימה שמורה"),
      isActive: pathname?.startsWith("/app/daily-report/defaults") ?? false,
    },
    {
      href: "/app/settings",
      label: tr(locale, "Settings", "הגדרות"),
      isActive: pathname?.startsWith("/app/settings") ?? false,
    },
  ];

  return (
    // Hidden below `sm`: AppBottomNav takes over there with just the 4
    // daily-use destinations - Manage Saved List/Settings/Sign out (kept
    // here unchanged for desktop) live inside the Profile page on mobile.
    <nav className="hidden border-b border-slate-200 bg-white sm:block">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1 px-6 py-2">
        {navItems.map((item) => (
          <GuardedLink
            key={item.href}
            href={item.href}
            confirmMessage={tr(locale, CONFIRM_MESSAGE_EN, CONFIRM_MESSAGE_HE)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              item.isActive ? "bg-teal-700 text-white" : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            {item.label}
          </GuardedLink>
        ))}

        {/* "Which account is this" at a glance on every page - separate from
            the "Profile" nav link above (which still goes to the same
            place), the way most apps keep a persistent account avatar
            distinct from an in-list nav entry. ms-auto here (not on the
            sign-out form below it) pushes this avatar + sign-out together
            as one trailing cluster, in normal flow order after it. */}
        <GuardedLink
          href="/app/profile"
          confirmMessage={tr(locale, CONFIRM_MESSAGE_EN, CONFIRM_MESSAGE_HE)}
          aria-label={tr(locale, "Profile", "פרופיל")}
          className="ms-auto flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        >
          <UserAvatar avatarColor={avatarColor} name={name} className="h-8 w-8 text-xs" />
        </GuardedLink>

        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            {tr(locale, "Sign out", "התנתקות")}
          </button>
        </form>
      </div>
    </nav>
  );
}
