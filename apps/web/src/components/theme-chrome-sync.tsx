"use client";

import { useEffect } from "react";

import { THEME_PREFERENCE_STORAGE_KEY, type AppThemePreference } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * TCK-175: keeps the phone's status/navigation bar colour (meta theme-color)
 * in step with the display mode, and remembers the preference on this device.
 * data-theme itself is left alone - CSS resolves "auto" via
 * prefers-color-scheme. For "auto" it listens for the OS switching modes
 * while the app is open, so the bar follows without a reload.
 */
export function ThemeChromeSync({ preference }: { preference: AppThemePreference }) {
  useEffect(() => {
    try {
      localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    } catch {
      // Private mode / storage disabled - the server-side preference still applies.
    }

    const mediaQuery = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const isDark = preference === "dark" || (preference === "auto" && mediaQuery.matches);
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute("content", isDark ? "#020617" : "#ffffff");
      });
    };
    apply();

    if (preference !== "auto") return;
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, [preference]);

  return null;
}
