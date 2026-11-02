"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { updateThemeAction } from "@/app/app/actions";
import { ProfileRow } from "@/components/profile-quick-edit";
import { tr, type AppLocale } from "@/lib/locale";
import { THEME_PREFERENCE_STORAGE_KEY, type AppThemePreference } from "@/lib/theme";

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ICONS: Record<AppThemePreference, ReactNode> = {
  auto: (
    <svg {...iconProps}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 18h3" />
    </svg>
  ),
  light: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  dark: (
    <svg {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  ),
};

const ORDER: AppThemePreference[] = ["auto", "light", "dark"];

/** Settings' Display mode row (TCK-175): automatic (follow the phone), light
 * or dark, as a slim three-icon switch. The change applies instantly by
 * rewriting data-theme on the app wrapper and any open portals, then is
 * saved to the profile in the background. */
export function DisplayModeRow({ locale, preference }: { locale: AppLocale; preference: AppThemePreference }) {
  const router = useRouter();
  const [current, setCurrent] = useState<AppThemePreference>(preference);
  const [, startTransition] = useTransition();

  // Resync when the server value changes (e.g. after a refresh). setTimeout,
  // not a direct call - see react-hooks/set-state-in-effect.
  useEffect(() => {
    const timeoutId = setTimeout(() => setCurrent(preference), 0);
    return () => clearTimeout(timeoutId);
  }, [preference]);

  const labels: Record<AppThemePreference, string> = {
    auto: tr(locale, "Automatic", "אוטומטי"),
    light: tr(locale, "Light", "בהיר"),
    dark: tr(locale, "Dark", "כהה"),
  };
  const captions: Record<AppThemePreference, string> = {
    auto: tr(locale, "Automatic, follows your phone", "אוטומטית, לפי הטלפון"),
    light: tr(locale, "Light", "בהיר"),
    dark: tr(locale, "Dark", "כהה"),
  };

  function select(next: AppThemePreference) {
    if (next === current) return;
    setCurrent(next);
    document.querySelectorAll("[data-theme]").forEach((element) => element.setAttribute("data-theme", next));
    try {
      localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, next);
    } catch {
      // Storage unavailable - the profile save below still persists it.
    }
    startTransition(async () => {
      await updateThemeAction(next);
      router.refresh();
    });
  }

  const label = tr(locale, "Display mode", "מצב תצוגה");
  const switcher = (
    <div role="radiogroup" aria-label={label} className="flex h-8 shrink-0 rounded-lg border-[0.5px] border-hairline">
      {ORDER.map((option) => {
        const checked = option === current;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={labels[option]}
            onClick={() => select(option)}
            className={`relative flex h-8 w-[38px] items-center justify-center first:rounded-s-lg last:rounded-e-lg after:absolute after:-inset-x-[3px] after:-inset-y-1.5 after:content-[''] ${
              checked ? "bg-brand-soft text-brand" : "bg-transparent text-icon-muted"
            }`}
          >
            {ICONS[option]}
          </button>
        );
      })}
    </div>
  );

  return <ProfileRow label={label} labelWeight="normal" caption={captions[current]} endSlot={switcher} />;
}
