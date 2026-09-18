export type AppTheme = "light" | "dark";

export function normalizeTheme(value: unknown): AppTheme {
  return value === "dark" ? "dark" : "light";
}
