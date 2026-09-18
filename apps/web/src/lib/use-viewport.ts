"use client";

import { useSyncExternalStore } from "react";

/**
 * The `sm` breakpoint (640px), read live off matchMedia - useSyncExternalStore,
 * not useEffect+setState, both because the latter trips this codebase's
 * react-hooks/set-state-in-effect rule and because it has no built-in answer
 * for what to render during SSR/first hydration. getServerSnapshot
 * deliberately returns true ("assume desktop") rather than a "not yet known"
 * placeholder - callers should have a plain, no-client-only-APIs desktop
 * render path that SSR and the first client paint can safely agree on; the
 * real value (and any mobile-only path that needs `document`, e.g. a portal)
 * only takes over once this resolves on the client, which is also the
 * earliest point `document` is guaranteed to exist anyway. Originally lived
 * only in daily-report-chat-panel.tsx; factored out here once
 * targets-chat-workspace.tsx needed the exact same detection for its own
 * desktop-inline-card vs. mobile-portal-sheet split.
 */
function subscribeToViewport(callback: () => void) {
  const mql = window.matchMedia("(min-width: 640px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getViewportSnapshot(): boolean {
  return window.matchMedia("(min-width: 640px)").matches;
}
function getServerViewportSnapshot(): boolean {
  return true;
}

export function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(subscribeToViewport, getViewportSnapshot, getServerViewportSnapshot);
}

/**
 * The actual visible height in CSS pixels, per window.visualViewport - the
 * one API iOS Safari itself provides specifically to answer "how much
 * screen can the user currently see", built to solve exactly this class of
 * problem. Used for a mobile chat sheet's height instead of svh/dvh: three
 * rounds of CSS-viewport-unit adjustments all still left a sheet's composer
 * below the visible area on a real device (see daily-report-chat-panel.tsx's
 * own history with this), meaning dvh/svh weren't tracking the actual
 * visible viewport the way the spec describes here. Returns null until the
 * first measurement lands, or on a browser too old to have visualViewport
 * at all - callers fall back to a fixed CSS height for that case.
 */
function subscribeToVisualViewport(callback: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", callback);
  return () => vv.removeEventListener("resize", callback);
}
function getVisualViewportHeight(): number | null {
  return window.visualViewport?.height ?? null;
}
function getServerVisualViewportHeight(): number | null {
  return null;
}

export function useVisualViewportHeight(): number | null {
  return useSyncExternalStore(subscribeToVisualViewport, getVisualViewportHeight, getServerVisualViewportHeight);
}
