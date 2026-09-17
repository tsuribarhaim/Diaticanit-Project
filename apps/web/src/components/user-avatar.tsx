import { resolveAvatarColorHex } from "@/lib/avatar-colors";
import { initialFromName } from "@/lib/avatar";

/**
 * The user's initial on a solid circle in their chosen color - used
 * everywhere the app shows "which account is this" (nav bars, the profile
 * page itself). No "use client" here: it's pure presentation (a <span>, no
 * hooks/interactivity), so it works as-is whether the caller is a Server
 * Component (profile/page.tsx) or a Client Component (the nav bars, which
 * already need "use client" for other reasons).
 */
export function UserAvatar({
  avatarColor,
  name,
  alt = "",
  className = "h-9 w-9 text-sm",
}: {
  /** A color id from lib/avatar-colors (e.g. "teal"), or the app's default
   * accent color when null/not yet chosen. */
  avatarColor?: string | null;
  name?: string | null;
  /** Decorative (empty) by default - the surrounding link/button usually
   * already carries its own aria-label (e.g. "Profile"), so labeling the
   * avatar too would just repeat it for a screen reader on every page. Pass
   * a real label only where this avatar isn't already inside one. */
  alt?: string;
  /** Sizing + font-size classes together, e.g. "h-9 w-9 text-sm" - kept as
   * one prop (not separate size/text props) since the two always change
   * together at every call site this component actually has. */
  className?: string;
}) {
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: resolveAvatarColorHex(avatarColor) }}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      {initialFromName(name)}
    </span>
  );
}
