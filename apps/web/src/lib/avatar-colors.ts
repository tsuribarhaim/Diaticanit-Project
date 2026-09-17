export type AvatarColorId = "teal" | "blue" | "violet" | "rose" | "amber" | "emerald";

export const AVATAR_COLOR_IDS: AvatarColorId[] = ["teal", "blue", "violet", "rose", "amber", "emerald"];

/** "teal" (the app's own accent color) is also the fallback when nothing's
 * been chosen yet - matches the app's default look elsewhere instead of an
 * arbitrary/random-feeling first color. */
export const DEFAULT_AVATAR_COLOR: AvatarColorId = "teal";

export function isAvatarColorId(value: string | null | undefined): value is AvatarColorId {
  return AVATAR_COLOR_IDS.includes(value as AvatarColorId);
}

export const AVATAR_COLOR_HEX: Record<AvatarColorId, string> = {
  teal: "#0F766E",
  blue: "#2563EB",
  violet: "#7C3AED",
  rose: "#E11D48",
  amber: "#D97706",
  emerald: "#059669",
};

/** The color actually shown for a given stored value, falling back to
 * DEFAULT_AVATAR_COLOR for null/invalid/not-yet-chosen. */
export function resolveAvatarColorHex(value: string | null | undefined): string {
  return AVATAR_COLOR_HEX[isAvatarColorId(value) ? value : DEFAULT_AVATAR_COLOR];
}
