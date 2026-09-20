export type AppTheme = "light" | "dark";

/** Falls back to "dark" (not "light") for a missing/unrecognized value -
 * matches the user_profile.theme_preference column's own default (see
 * db/migrations/043), so a profile row that genuinely has no explicit
 * preference stored reads the same way here as it would from a fresh
 * insert. Every EXISTING user already has an explicit 'light' or 'dark'
 * value stored (migration 037 backfilled every row), so this only affects
 * the rare case of a still-missing column or a truly null value, not
 * anyone's already-chosen theme. */
export function normalizeTheme(value: unknown): AppTheme {
  return value === "light" ? "light" : "dark";
}
