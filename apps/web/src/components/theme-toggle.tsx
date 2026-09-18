"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { updateThemeAction } from "@/app/app/actions";
import { tr, type AppLocale } from "@/lib/locale";
import type { AppTheme } from "@/lib/theme";

export function ThemeToggle({ locale, theme }: { locale: AppLocale; theme: AppTheme }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function selectTheme(nextTheme: AppTheme) {
    if (nextTheme === theme || isPending) return;
    startTransition(async () => {
      await updateThemeAction(nextTheme);
      router.refresh();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label={tr(locale, "Theme", "ערכת נושא")}
      className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold dark:border-slate-700"
    >
      <button
        type="button"
        role="radio"
        aria-checked={theme === "light"}
        disabled={isPending}
        onClick={() => selectTheme("light")}
        className={`px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-70 ${
          theme === "light"
            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        {tr(locale, "Light", "בהיר")}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={theme === "dark"}
        disabled={isPending}
        onClick={() => selectTheme("dark")}
        className={`px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-70 ${
          theme === "dark"
            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        {tr(locale, "Dark", "כהה")}
      </button>
    </div>
  );
}
