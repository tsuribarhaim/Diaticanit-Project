export type AppThemePreference = "auto" | "light" | "dark";

/** localStorage key holding the last-applied display mode on this device
 * (TCK-175), written whenever the preference is applied or changed. */
export const THEME_PREFERENCE_STORAGE_KEY = "daffy-theme-preference";

/** "auto" follows the phone/OS prefers-color-scheme; "light"/"dark" are an
 * explicit choice that always wins over the OS. Anything missing or
 * unrecognized falls back to "auto" - the user_profile.theme_preference
 * column's default since migration 086 (TCK-175). Existing users keep the
 * explicit 'light'/'dark' value already stored for them. */
export function normalizeThemePreference(value: unknown): AppThemePreference {
  return value === "light" || value === "dark" ? value : "auto";
}
