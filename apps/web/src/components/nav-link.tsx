"use client";

import Link, { useLinkStatus, type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { Spinner } from "@/components/spinner";

/**
 * A small spinner that centers itself over whatever is passed as
 * children, invisible (not unmounted, so no layout shift) while
 * useLinkStatus().pending is false - the actual content shows normally.
 * Must be rendered as a child of the <Link> it reports on (Next's own
 * requirement for useLinkStatus), which is why this is a separate
 * component from NavLink/GuardedLink below rather than inlined into them.
 *
 * Built after confirming live that plain navigation Links in this app
 * give zero visual feedback while a transition is in flight, which can
 * take several real seconds (a genuine server round-trip for the target
 * page's own data) - reported as "the Close button feels locked" when it
 * wasn't actually broken, just silent. `invisible` (not `hidden`)
 * preserves the original element's box so nothing shifts or collapses
 * while dimmed - safe to drop into a plain text link, an icon button, or
 * a whole card-as-link alike, since it never touches the children's own
 * DOM structure.
 */
function PendingOverlay({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className={pending ? "invisible" : undefined}>{children}</span>
      {pending ? <Spinner className="absolute inset-0 m-auto h-4 w-4 animate-spin text-current" /> : null}
    </>
  );
}

export { PendingOverlay };

/**
 * Drop-in replacement for next/link's own Link, everywhere a tap should
 * give immediate visible feedback while its navigation is in flight (see
 * PendingOverlay's own comment for why that matters here) - the default
 * for any new navigation link in this app; use plain Link only for a case
 * that genuinely shouldn't show pending state (rare - e.g. an external
 * link that isn't a client-side transition at all).
 */
export function NavLink({
  children,
  className,
  ...props
}: LinkProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & { children: ReactNode; className?: string }) {
  return (
    <Link {...props} className={`relative ${className ?? ""}`}>
      <PendingOverlay>{children}</PendingOverlay>
    </Link>
  );
}
