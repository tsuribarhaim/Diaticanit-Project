"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { openTicketAttachmentAction } from "@/app/app/tickets/actions";
import { formatFileSize } from "@/lib/documents";
import { tr, type AppLocale } from "@/lib/locale";

type Attachment = { id: string; file_name: string; file_size_bytes: number | null };

type ViewerState =
  | { status: "closed" }
  | { status: "loading"; fileName: string }
  | { status: "open"; signedUrl: string; mimeType: string; fileName: string }
  | { status: "error"; error: string; fileName: string };

function previewKind(mimeType: string): "image" | "embed" | null {
  if (mimeType.startsWith("image/")) return "image";
  // PDF and plain text both render fine directly in an iframe via the
  // browser's own built-in viewer - anything else (Word docs, etc.) has no
  // reliable in-browser preview, so it falls through to the "not
  // supported" message instead of a broken/blank embed.
  if (mimeType === "application/pdf" || mimeType === "text/plain") return "embed";
  return null;
}

/**
 * Replaces the old <form action={openTicketAttachmentAction}> + submit
 * button, which did a real server-side redirect() to the signed storage
 * URL - taking over the current tab entirely. Confirmed live that this
 * left the user genuinely outside the app's origin/PWA shell with no
 * "Close" affordance, and the browser back button sometimes exited the
 * app instead of returning to the ticket. This opens the same signed URL
 * inside an in-app modal instead, so the current page/tab never actually
 * navigates away - Close (or Escape, or clicking the backdrop) just clears
 * local state.
 */
export function TicketAttachmentViewer({ locale, attachments }: { locale: AppLocale; attachments: Attachment[] }) {
  const [state, setState] = useState<ViewerState>({ status: "closed" });
  // See daily-report-chat-panel.tsx's own isMounted guard for why this
  // portal can't render unconditionally - createPortal(..., document.body)
  // would otherwise run during React's server render pass too, where
  // document doesn't exist.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => setIsMounted(true), 0);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (state.status === "closed") return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setState({ status: "closed" });
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [state.status]);

  async function handleOpen(attachment: Attachment) {
    setState({ status: "loading", fileName: attachment.file_name });
    const result = await openTicketAttachmentAction(attachment.id);
    if ("error" in result) {
      setState({ status: "error", error: result.error, fileName: attachment.file_name });
      return;
    }
    setState({ status: "open", signedUrl: result.signedUrl, mimeType: result.mimeType, fileName: result.fileName });
  }

  function close() {
    setState({ status: "closed" });
  }

  return (
    <>
      <ul className="mt-1.5 space-y-1">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              onClick={() => void handleOpen(attachment)}
              disabled={state.status === "loading" && state.fileName === attachment.file_name}
              className="text-sm font-semibold text-teal-700 hover:underline disabled:cursor-wait disabled:opacity-70 dark:text-teal-400"
            >
              {attachment.file_name}
              {attachment.file_size_bytes ? ` (${formatFileSize(attachment.file_size_bytes)})` : ""}
              {state.status === "loading" && state.fileName === attachment.file_name ? ` — ${tr(locale, "Opening...", "פותח...")}` : ""}
            </button>
          </li>
        ))}
      </ul>

      {isMounted && state.status !== "closed"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 dark:bg-black/60"
              onClick={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{state.fileName}</p>
                  <button
                    type="button"
                    onClick={close}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    {tr(locale, "Close", "סגירה")}
                  </button>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-100 dark:bg-slate-950">
                  {state.status === "loading" ? (
                    <p className="p-8 text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Opening...", "פותח...")}</p>
                  ) : state.status === "error" ? (
                    <p className="p-8 text-center text-sm text-rose-700 dark:text-rose-400">{state.error}</p>
                  ) : previewKind(state.mimeType) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed, time-limited, single-use URL; next/image's optimizer adds no value here and would need the storage domain allowlisted for no benefit.
                    <img src={state.signedUrl} alt={state.fileName} className="max-h-[70vh] max-w-full object-contain" />
                  ) : previewKind(state.mimeType) === "embed" ? (
                    <iframe src={state.signedUrl} title={state.fileName} className="h-[70vh] w-full border-0 bg-white" />
                  ) : (
                    <div className="max-w-sm p-8 text-center text-sm text-slate-600 dark:text-slate-400">
                      <p>{tr(locale, "Preview isn't available for this file type yet.", "אין תצוגה מקדימה זמינה עבור סוג קובץ זה כרגע.")}</p>
                      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                        {tr(locale, "Supported: images, PDF, and text files.", "נתמך: תמונות, PDF וקבצי טקסט.")}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex justify-end border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {tr(locale, "Close", "סגירה")}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
