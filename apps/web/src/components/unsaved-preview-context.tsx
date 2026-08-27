"use client";

import Link, { type LinkProps } from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type UnsavedPreviewContextValue = {
  hasUnsavedPreview: boolean;
  setHasUnsavedPreview: (value: boolean) => void;
};

const UnsavedPreviewContext = createContext<UnsavedPreviewContextValue | null>(null);

/**
 * Tracks whether a generated-but-not-yet-locked target preview exists
 * anywhere on the page, so navigation away from it (in-app link clicks or
 * closing/refreshing the tab) can warn the user first.
 */
export function UnsavedPreviewProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedPreview, setHasUnsavedPreview] = useState(false);

  useEffect(() => {
    if (!hasUnsavedPreview) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedPreview]);

  return (
    <UnsavedPreviewContext.Provider value={{ hasUnsavedPreview, setHasUnsavedPreview }}>
      {children}
    </UnsavedPreviewContext.Provider>
  );
}

export function useUnsavedPreview(): UnsavedPreviewContextValue {
  const context = useContext(UnsavedPreviewContext);
  if (!context) {
    throw new Error("useUnsavedPreview must be used within an UnsavedPreviewProvider");
  }
  return context;
}

/** A normal in-app `Link` that confirms before navigating away from an unlocked preview. */
export function GuardedLink({
  confirmMessage,
  onClick,
  ...linkProps
}: LinkProps & { confirmMessage: string; children: ReactNode; className?: string }) {
  const { hasUnsavedPreview } = useUnsavedPreview();

  return (
    <Link
      {...linkProps}
      onClick={(event) => {
        if (hasUnsavedPreview && !window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
