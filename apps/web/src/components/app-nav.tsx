"use client";

import { usePathname } from "next/navigation";

import { GuardedLink } from "@/components/unsaved-preview-context";
import { tr, type AppLocale } from "@/lib/locale";

const CONFIRM_MESSAGE_EN = "You have a generated target plan that hasn't been locked in yet. Leave this page anyway?";
const CONFIRM_MESSAGE_HE = "יש לך תכנית יעדים שנוצרה אך טרם ננעלה. לעזוב את הדף בכל זאת?";

export function AppNav({ locale }: { locale: AppLocale }) {
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
      label: tr(locale, "Manage defaults", "ניהול ברירות מחדל"),
      isActive: pathname?.startsWith("/app/daily-report/defaults") ?? false,
    },
  ];

  return (
    <nav className="border-b border-slate-200 bg-white">
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
      </div>
    </nav>
  );
}
