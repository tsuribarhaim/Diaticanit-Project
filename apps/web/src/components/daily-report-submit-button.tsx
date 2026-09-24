"use client";

import { useFormStatus } from "react-dom";

import { tr, type AppLocale } from "@/lib/locale";

/**
 * Submits the shared daily-report <form> regardless of which component
 * renders it - useFormStatus() reflects the nearest ancestor form's pending
 * state no matter where in the tree this button sits, so both the chat
 * panel (quick save) and the non-AI fallback textarea can use the exact
 * same button/behavior.
 */
function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** A floppy-disk "save" glyph, matching the stroke-line icon style used
 * throughout the app (entryIconPaths, the chat bubble trigger, etc.) rather
 * than an emoji - keeps this button visually consistent with every other
 * icon-only control on the page instead of standing out as a different
 * icon language. */
function SaveIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3h10l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M8 3v4h6V3" />
      <rect x="8" y="13" width="8" height="6" rx="0.5" />
    </svg>
  );
}

/** A filled (not outlined) floppy disk, specifically for the "bare-icon"
 * variant below - drawn solid rather than as a thin stroke since it has no
 * background chip of its own to set it apart from whatever's behind it on
 * the page; the white cutouts (folded corner, label area) are what read as
 * "floppy disk" rather than a plain teal blob. */
function FilledSaveIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" d="M5 3h10l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path fill="#fff" d="M8 3h6v4H8z" />
      <rect fill="#fff" x="8" y="13" width="8" height="6" rx="0.5" />
    </svg>
  );
}

export function SubmitButton({
  locale,
  onClick,
  isEditing = false,
  fullWidth = false,
  variant = "text",
  disabled = false,
  busy = false,
  form,
}: {
  locale: AppLocale;
  onClick?: () => void;
  /** True when this save will update a previously saved report (see the
   * "Edit entry" button on the daily-report list) rather than create a new
   * one - swaps the label so it's clear a save here overwrites, not adds. */
  isEditing?: boolean;
  /** The Daily Report V2 redesign's pinned composer dock wants this as a
   * full-width primary CTA; the plain-text fallback form below it keeps the
   * original inline-sized button - default false preserves that. Ignored
   * when variant is "icon". */
  fullWidth?: boolean;
  /** "icon" renders a small round floppy-disk button instead of the
   * labeled bar - used for the floating save trigger next to the chat
   * bubble on mobile, where a full-width labeled button would be exactly
   * the "takes a lot of space, not next to what changed" complaint this
   * was built to fix. "bare-icon" is the same idea taken further - just
   * the colored floppy-disk glyph itself, no circle/background/border at
   * all, for the top-corner quick-save trigger on the daily-report page
   * (see its own render site: shown only while there's something to save,
   * not merely disabled-but-visible the way "icon" and "text" stay, so
   * this variant is never actually rendered in a disabled state in
   * practice). Submits the exact same form/action either way. */
  variant?: "text" | "icon" | "bare-icon";
  /** Lets a caller disable this independently of the form's own pending
   * state - e.g. the floating save icon should read as inactive until
   * something has actually changed, not just while a submit is in flight. */
  disabled?: boolean;
  /** A caller-tracked "this was just clicked, a submit is underway" signal,
   * shown in addition to (not instead of) useFormStatus's own `pending`.
   * Exists because a caller that also folds pending state into the form
   * right before submitting (see the chat panel's handleQuickSave, which
   * uses flushSync to do this) can hit React/browser timing where a submit
   * that genuinely fired and genuinely completed still leaves `pending`
   * reading false the whole time from this button's perspective - `busy`
   * is reset independently, from the save result actually arriving as a
   * prop, so the spinner can't get stranded regardless of that timing. */
  busy?: boolean;
  /** The id of the `<form>` this button submits, for when it's rendered
   * somewhere other than a DOM descendant of that form - e.g. portaled to
   * document.body (see the daily-report chat panel's mobile sheet). Native
   * HTML form submission is DOM-ancestry-based, unlike React's own
   * useFormStatus/context below, which keeps working through a portal
   * regardless since React's tree (not the DOM's) is what it follows -
   * only the actual submit trigger needs this explicit association. */
  form?: string;
}) {
  const { pending } = useFormStatus();
  const isBusy = pending || busy;
  // `busy` deliberately does NOT feed into isDisabled. The chat panel sets
  // it synchronously (inside the same flushSync flush that folds pending
  // text into the form) right when this button is clicked - if that also
  // disabled the button, the button could end up disabled before the
  // browser gets to actually submit the very click that set it, silently
  // swallowing the submission entirely (confirmed: this caused a real
  // "spinner shows, nothing ever saved" bug). `pending` (React's own,
  // accurate once a submission is genuinely underway) is what actually
  // guards against a double-submit; `busy` only ever affects the spinner.
  const isDisabled = pending || disabled;

  const idleLabel = isEditing ? tr(locale, "Save changes", "שמירת שינויים") : tr(locale, "Report", "דיווח");
  const pendingLabel = isEditing ? tr(locale, "Saving changes...", "שומר שינויים...") : tr(locale, "Saving...", "שומר...");

  if (variant === "icon") {
    return (
      <button
        type="submit"
        form={form}
        disabled={isDisabled}
        onClick={onClick}
        aria-label={isBusy ? pendingLabel : idleLabel}
        title={isBusy ? pendingLabel : idleLabel}
        className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-colors ${
          isDisabled
            ? "cursor-not-allowed bg-slate-200 text-slate-400 shadow-none dark:bg-slate-800 dark:text-slate-600"
            : "bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
        }`}
      >
        {isBusy ? <Spinner className="h-5 w-5 animate-spin" /> : <SaveIcon className="h-6 w-6" />}
      </button>
    );
  }

  if (variant === "bare-icon") {
    return (
      <button
        type="submit"
        form={form}
        disabled={isDisabled}
        onClick={onClick}
        aria-label={isBusy ? pendingLabel : idleLabel}
        title={isBusy ? pendingLabel : idleLabel}
        className="relative flex h-10 w-10 items-center justify-center text-teal-700 drop-shadow-md transition-transform active:scale-95 disabled:text-slate-400 disabled:drop-shadow-none dark:text-teal-400 dark:disabled:text-slate-600"
      >
        {isBusy ? (
          <Spinner className="h-6 w-6 animate-spin" />
        ) : (
          <>
            <FilledSaveIcon className="h-7 w-7" />
            {/* Small alert dot, not just the recolored icon alone - picked
                over a full color swap or background chip so the icon stays
                the same teal used everywhere else in the app, with just an
                attention cue layered on top. */}
            <span aria-hidden="true" className="absolute end-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-500" />
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="submit"
      form={form}
      disabled={isDisabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 ${fullWidth ? "w-full" : ""}`}
    >
      {isBusy ? pendingLabel : idleLabel}
    </button>
  );
}
