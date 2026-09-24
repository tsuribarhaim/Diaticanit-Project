"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import {
  saveDailyReportAction,
  type DailyReportActionState,
} from "@/app/app/daily-report/actions";
import { DailyReportChatPanel, type DailyReportDefaultItem } from "@/components/daily-report-chat-panel";
import { DailyReportDefaultsPicker, type SelectedSavedListItem } from "@/components/daily-report-defaults-picker";
import { DailyReportSuccessToast } from "@/components/daily-report-success-toast";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { TargetsStaleModal } from "@/components/targets-stale-modal";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { directionForLocale, formatDefaultUnit, formatMeasurementUnit, tr, type AppLocale } from "@/lib/locale";

const initialState: DailyReportActionState = {};

/**
 * True only once the client has actually mounted - used below to gate the
 * targetsStaleChanges/pendingRangeConfirm portal's createPortal(...,
 * document.body) call, which would otherwise crash during SSR (document
 * doesn't exist there). Prefer this over a one-shot inline `typeof document
 * !== "undefined"` check: that check can run correctly in theory, but
 * nothing then forces a second render if the very first pass somehow
 * missed it - useSyncExternalStore's whole job is guaranteeing a real,
 * correctly-timed re-render once the client value differs from the server
 * one. subscribe is a no-op since nothing ever un-mounts this true.
 * (The Weight/Sleep portal used to be gated by this too, but a plain
 * isMounted check only guarantees ONE re-render once mounted - it doesn't
 * guarantee the portal's actual target DOM node exists by then, which is
 * exactly what let that portal go silently missing; see
 * quickMetricsTarget's own comment for the real fix.)
 */
function subscribeMounted() {
  return () => {};
}
function getMountedSnapshot() {
  return true;
}
function getServerMountedSnapshot() {
  return false;
}

const REPORT_MAX_LENGTH = 2000;
/** How long the post-save toast (see DailyReportSuccessToast) stays up
 * before auto-dismissing - also how long an edit-save's exit from edit
 * mode is deliberately delayed, so the page doesn't navigate (and
 * potentially remount this whole form, clearing the toast's own timer)
 * while the toast is still meant to be showing. */
const SAVE_TOAST_DURATION_MS = 2000;

function getLocalDateTimeValue(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const offsetMs = copy.getTimezoneOffset() * 60_000;
  return new Date(copy.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * The wall-clock value a brand-new (non-edit) report defaults to - "now",
 * but with the calendar day forced to whatever date is currently being
 * browsed (selectedDateParam, e.g. from the "Jump to a date" picker or the
 * prev/next day arrows) instead of always the real current day. Without
 * this, saving a new entry while browsing a past day silently logged it
 * under TODAY (wrong graphs, wrong list, nowhere near where the user was
 * actually looking) - confirmed as the cause of "a log I saved isn't
 * showing up" reports. Keeps the actual current time-of-day (only the date
 * part is swapped) - there's no meaningful "what time did this happen"
 * signal for a backdated entry beyond "whenever the user is currently
 * logging it".
 */
function buildReportAtValueForSelectedDate(selectedDateParam?: string): string {
  const nowValue = getLocalDateTimeValue(new Date());
  if (selectedDateParam && selectedDateParam !== nowValue.slice(0, 10)) {
    return `${selectedDateParam}T${nowValue.slice(11)}`;
  }
  return nowValue;
}

export type LoggableCustomTarget = { id: string; label: string; unit: string };

export type EditingDailyReport = {
  id: string;
  rawReportText: string;
  reportedWeightKg: number | null;
  reportAt: string;
  selectedDefaults: Array<{ id: string; quantity: number }>;
  customTargetValues: Record<string, number>;
  /** Plain-text, locale-formatted line-per-item recap of exactly what this
   * report currently contains (see page.tsx) - shown in the chat panel's
   * edit-mode intro so the user sees what's in the entry immediately. */
  itemsSummaryText: string;
};

function toLocalDateTimeValue(isoString: string): string {
  const parsed = new Date(isoString);
  return Number.isNaN(parsed.getTime()) ? getLocalDateTimeValue(new Date()) : getLocalDateTimeValue(parsed);
}

export function DailyReportForm({
  defaultItems,
  aiAvailable,
  locale,
  currentWeightKg,
  customTargets = [],
  todaysCustomTargetValues = {},
  editingReport = null,
  selectedDateParam,
  userFirstName,
  userGender,
}: {
  defaultItems: DailyReportDefaultItem[];
  aiAvailable: boolean;
  locale: AppLocale;
  currentWeightKg?: number | null;
  /** Custom targets from the user's locked plan (e.g. "Sleep duration") that
   * carry a unit/range and are therefore loggable here - see
   * apps/app/targets: UserTargetEntry.id/unit/targetMin/targetMax. */
  customTargets?: LoggableCustomTarget[];
  /** Whatever value the user already logged for each custom target on the
   * day currently being viewed (most-recent-report-wins), keyed by target
   * id - lets the quick-entry field below keep showing e.g. today's already-
   * saved sleep duration on a fresh page load, not just right after saving
   * in the same session, so the user can tell at a glance it's already
   * logged. Only ever reflects the day being viewed (see page.tsx's own
   * comment) - a real day change remounts this whole form (see its `key`
   * there), which is what actually clears this back to empty on a new day. */
  todaysCustomTargetValues?: Record<string, number>;
  /** Present when arriving via the "Edit entry" button on a previously
   * saved report (see the daily-report page's `edit` search param) - seeds
   * every input from that report's original content and switches the
   * terminal save into an update of that same row instead of a new insert. */
  editingReport?: EditingDailyReport | null;
  /** The daily-report page's own `date` filter, if any, carried through as
   * a hidden field so saveDailyReportAction's post-edit redirect returns to
   * the same day's view instead of silently jumping to today. */
  selectedDateParam?: string;
  /** For the chat panel's own static greeting/intro copy (see
   * DailyReportChatPanel) - an occasional first-name mention and
   * grammatically correct Hebrew addressing, mirroring the same rules the
   * AI chat itself now follows (see lib/ai/persona.ts). */
  userFirstName?: string | null;
  userGender?: "male" | "female" | null;
}) {
  // The critical "which report does this save update" decision must never
  // depend on editingReport (a server-rendered prop) alone: Next.js's
  // client router cache can intermittently serve a stale render of this
  // page for a repeat visit to the same `?edit=...` URL within one
  // browsing session, in which case editingReport silently comes back null
  // even though the address bar still says otherwise - and a save that
  // quietly falls back to "create new" instead of "update" is a much worse
  // failure mode than briefly showing stale seed content. Reading the id
  // straight from the live URL sidesteps that: useSearchParams() always
  // reflects the browser's actual current URL, never a cached RSC payload.
  const searchParams = useSearchParams();
  const liveEditReportId = searchParams.get("edit");
  const highlightReportId = searchParams.get("highlight");
  const router = useRouter();
  // The stale-cache risk described above isn't just theoretical for the
  // save-target decision - it was confirmed live: switching from editing one
  // report straight to "Edit in chat" on a different one sometimes kept
  // showing the FIRST report's chat history/weight/custom targets even
  // though the address bar (and liveEditReportId) already pointed at the
  // second. This whole component still seeds its state from the editingReport
  // PROP below (that's the only content that actually differs per report,
  // and threading liveEditReportId through every one of those seeds instead
  // would be far more invasive) - so the moment a mismatch between the live
  // URL and what actually got rendered is detected, force a real server
  // round-trip via router.refresh() rather than let anything seed from data
  // that belongs to a different report. This never fires in the normal case
  // (a fresh server render already has them matching) and self-clears the
  // instant a matching render lands. Only ever retried once per distinct
  // liveEditReportId (not on every render while it stays mismatched) - a
  // stale-cache mismatch is expected to resolve on that first refresh, but a
  // report that's genuinely gone (e.g. deleted while ?edit= is still in the
  // URL) never will, and refreshing forever on every render would be an
  // infinite loop rather than a fix.
  const attemptedRefreshForRef = useRef<string | null>(null);
  useEffect(() => {
    if (liveEditReportId === (editingReport?.id ?? null)) return;
    if (attemptedRefreshForRef.current === liveEditReportId) return;
    attemptedRefreshForRef.current = liveEditReportId;
    router.refresh();
  }, [liveEditReportId, editingReport?.id, router]);
  const [state, formAction] = useActionState(saveDailyReportAction, initialState);
  // Scrolls to and briefly highlights whichever report row a save just
  // touched - state.savedReportId for a brand-new report (saved in place,
  // no navigation), or the `highlight` URL param for an edit (which
  // redirects instead - see buildDailyReportRedirectPath). Direct DOM
  // manipulation rather than React state because the target row is
  // rendered by the PAGE (a Server Component, a sibling of this whole
  // form, not a descendant of it) - there's no shared React tree to pass a
  // "highlight this one" prop through, but both ultimately land in the same
  // DOM, which this can reach into once mounted. Uses classList directly
  // (not a style/class toggling via React state) for the same reason: nothing
  // here owns that DOM node.
  useEffect(() => {
    const targetId = state.savedReportId ?? highlightReportId;
    if (!targetId) return;

    const element = document.getElementById(`daily-report-entry-${targetId}`);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("ring-2", "ring-teal-500", "bg-teal-50");
    const timeoutId = setTimeout(() => {
      element.classList.remove("ring-2", "ring-teal-500", "bg-teal-50");
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [state.savedReportId, highlightReportId]);
  const [reportText, setReportText] = useState(() => editingReport?.rawReportText ?? "");
  const [chatResetKey, setChatResetKey] = useState(0);
  const [reportAtValue, setReportAtValue] = useState(() =>
    editingReport ? toLocalDateTimeValue(editingReport.reportAt) : buildReportAtValueForSelectedDate(selectedDateParam),
  );
  const [fallbackSelectedSavedListItems, setFallbackSelectedSavedListItems] = useState<SelectedSavedListItem[]>([]);
  // Deliberately NOT pre-filled with the user's current weight as a
  // starting *value* (only shown as a placeholder hint below) - a
  // pre-filled value is submitted exactly like a real entry, so if the
  // user only mentioned a new weight in the chat text and never touched
  // this field, the stale pre-filled number would silently win over the
  // one actually extracted from their message (saveDailyReportAction
  // prefers an explicit reported_weight_kg over text-extracted weight).
  // Leaving it empty when untouched lets that text-extraction fallback
  // through correctly. When editing, though, the field IS pre-filled with
  // that report's own previously-saved weight (if any) - there's no "the
  // user hasn't touched this yet" ambiguity to protect here, and leaving it
  // blank would silently drop the original weight on save.
  const initialWeightValue = currentWeightKg != null ? String(currentWeightKg) : "";
  const editingWeightValue = editingReport?.reportedWeightKg != null ? String(editingReport.reportedWeightKg) : "";
  const [weightValue, setWeightValue] = useState(editingWeightValue);
  // The baseline weightValue is compared against for "has this been
  // edited" - starts empty (matching weightValue's own starting point
  // above), but advances to whatever was just saved after a successful
  // submit (see below), since weightValue intentionally isn't cleared on
  // save (convenient prefill for the next report) and shouldn't therefore
  // read as permanently "unsaved." When editing, it starts at the loaded
  // report's own weight for the same reason - that's not an unsaved edit.
  // State, not a ref: isDirty (below) needs to read it during render, and
  // reading a ref's .current there is a lint error (react-hooks/refs) -
  // it's only ever written from an effect anyway, exactly what state is for.
  const [weightBaseline, setWeightBaseline] = useState(editingWeightValue);
  // currentWeightKg reflects whatever the server currently considers the
  // profile's current weight - it can change for reasons OTHER than this
  // form's own save, e.g. deleting the report that held the value currently
  // sitting in this field (see weightValue's own comment on why a save
  // deliberately leaves it populated) - nothing else clears the field when
  // that happens, so it kept showing a now-deleted number indefinitely
  // (reported as "I deleted the weight entry and the field still shows
  // it"). Adjusted during render (same pattern as prevState/prevFeedbackKey
  // elsewhere in this codebase) rather than in an effect, since setState
  // directly inside an effect body is a lint error here. Only resyncs when
  // there's no in-progress unsaved edit (weightValue === weightBaseline) -
  // this must never overwrite something the user is actively typing just
  // because the background "current" value happened to change from
  // something unrelated.
  const [prevCurrentWeightKg, setPrevCurrentWeightKg] = useState(currentWeightKg);
  if (currentWeightKg !== prevCurrentWeightKg) {
    setPrevCurrentWeightKg(currentWeightKg);
    const currentWeightString = currentWeightKg != null ? String(currentWeightKg) : "";
    if (weightValue === weightBaseline && weightValue !== "" && weightValue !== currentWeightString) {
      setWeightValue("");
      setWeightBaseline("");
    }
  }
  // Custom target inputs (Sleep duration, etc.) - controlled, and seeded
  // from whichever is relevant: the specific report being edited, or
  // otherwise whatever's already been logged for the day being viewed (see
  // todaysCustomTargetValues' own comment). Controlled (unlike the old
  // defaultValue-only version) specifically so a successful save doesn't
  // wipe it: React 19 auto-resets uncontrolled fields once a form action
  // succeeds, which used to make the Sleep field go blank right after
  // saving even though the value was still true for the rest of the day.
  const initialCustomTargetValues = (): Record<string, string> => {
    const initial: Record<string, string> = {};
    for (const target of customTargets) {
      const value = editingReport?.customTargetValues[target.id] ?? todaysCustomTargetValues[target.id];
      initial[target.id] = value !== undefined ? String(value) : "";
    }
    return initial;
  };
  const [customTargetValues, setCustomTargetValues] = useState(initialCustomTargetValues);
  // Same "has this been edited since the last save" role as weightBaseline
  // above, for the same reason - advances to the just-saved values on a
  // successful save (see below) rather than the values themselves resetting.
  const [customTargetsBaseline, setCustomTargetsBaseline] = useState(initialCustomTargetValues);
  const customTargetsChanged = customTargets.some(
    (target) => (customTargetValues[target.id] ?? "") !== (customTargetsBaseline[target.id] ?? ""),
  );
  // Which specific target ids actually changed THIS save vs. only sitting
  // pre-filled with today's already-logged value (see initialCustomTargetValues'
  // own comment on why every field starts pre-filled, not blank) - submitted
  // alongside the values themselves so the server can record only what
  // genuinely changed on this entry instead of every manual target being
  // silently re-recorded on every save (ticket #61).
  const changedCustomTargetIds = customTargets
    .filter((target) => (customTargetValues[target.id] ?? "") !== (customTargetsBaseline[target.id] ?? ""))
    .map((target) => target.id);
  // Gates the Weight/Sleep portal lookup below until the client has
  // definitely mounted - see subscribeMounted's comment above.
  const isMounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerMountedSnapshot);

  // The Weight/Sleep portal's target node - looked up in an effect
  // (below), not read via a synchronous document.getElementById call
  // during render like it used to be. That direct-during-render read is
  // what caused a real, confirmed bug: "the weight and sleep fields
  // disappeared," which only came back after a full page refresh.
  // <div id="daily-report-quick-metrics"> (in page.tsx) renders
  // unconditionally in the same tree as this form, so on an ordinary
  // hydration the two are never actually racing - the server-rendered
  // HTML already contains that div before React even starts, so the very
  // first client read always finds it. But render-phase code only ever
  // sees the DOM as of the END of the PREVIOUS commit - it runs entirely
  // before this render's own commit lands. Any time this whole subtree
  // gets a fresh client-only render together with that div - e.g. React
  // silently recovering from a hydration mismatch elsewhere on the page
  // by discarding the server HTML and re-rendering from scratch on the
  // client - both this component and the target div are being created in
  // the SAME upcoming commit, and a same-render sibling genuinely isn't
  // in the DOM yet at the moment this line would have run. The portal
  // then silently renders nothing, and nothing here ever rechecks it
  // again afterward, so the fields stay gone until some unrelated
  // re-render happens to land after the div exists - or, more reliably,
  // until a refresh forces a clean hydration again. Looking it up in an
  // effect instead - which always runs AFTER its own commit - guarantees
  // the div (part of that very same commit) already exists in the DOM by
  // the time this runs, regardless of which render pass created it.
  const [quickMetricsTarget, setQuickMetricsTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // setState wrapped in a callback (not called directly in the effect
    // body) - same idiom used elsewhere in this codebase (see
    // DailyReportPageNotice) to satisfy the react-hooks/set-state-in-effect
    // rule. A 0ms timeout doesn't reintroduce the race this is fixing: the
    // effect itself already only runs after this render's own commit has
    // landed, so the target div is already in the DOM by the time this
    // fires either way.
    const timeoutId = setTimeout(() => {
      setQuickMetricsTarget(document.getElementById("daily-report-quick-metrics"));
    }, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  // Set right before programmatically re-submitting after the user confirms
  // an out-of-range custom target value (see handleFormSubmit) - lets that
  // resubmission skip the same reasonableness check it just passed, instead
  // of looping back into the same confirmation dialog forever.
  const bypassRangeConfirmRef = useRef(false);
  // Set (not null) when a custom target value looks like a likely typo
  // rather than a deliberate entry - currently only hour-denominated targets
  // (Sleep duration, etc.) reporting more than 12 hours in a single day -
  // and blocks the actual save until the user confirms via the dialog below.
  const [pendingRangeConfirm, setPendingRangeConfirm] = useState<{ target: LoggableCustomTarget; value: number } | null>(null);
  // Bumped every time handleFormSubmit blocks a submit for confirmation -
  // handed to DailyReportChatPanel as saveBlockedSignal so it can clear its
  // own independently-tracked "saving" spinner the moment that happens (see
  // that component's own comment on why it needs telling separately: it
  // flips that spinner on optimistically, in the same click that triggers
  // the browser's native submit, before this handler gets a chance to
  // preventDefault it - so nothing else would ever tell it the submit it
  // was expecting never actually happened).
  const [saveBlockedSignal, setSaveBlockedSignal] = useState(0);

  function findOutOfRangeCustomTarget(): { target: LoggableCustomTarget; value: number } | null {
    for (const target of customTargets) {
      const unit = target.unit.trim().toLowerCase();
      if (unit !== "hour" && unit !== "hours") continue;
      const raw = customTargetValues[target.id]?.trim();
      if (!raw) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 12) {
        return { target, value };
      }
    }
    return null;
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (bypassRangeConfirmRef.current) {
      bypassRangeConfirmRef.current = false;
      return;
    }
    const outOfRange = findOutOfRangeCustomTarget();
    if (outOfRange) {
      event.preventDefault();
      setPendingRangeConfirm(outOfRange);
      setSaveBlockedSignal((count) => count + 1);
    }
  }

  // Warns before navigating away (nav bar links) once the user has typed a
  // report, entered a weight, touched a custom target, or picked saved-list
  // items - same guard/modal already used on the Targets page. Unlike
  // Profile/Onboarding, a successful save doesn't navigate away - the form
  // resets itself in place (see the reportText/reportAtValue reset below) -
  // so clearing on state.success (handled in that same reset block) is what
  // actually matters here, not on unmount. Also passed down to the chat
  // panel (as `hasChanges`) so its floating save icon can reflect the same
  // "is there anything to save" signal instead of always being active.
  const isDirty =
    reportText.trim().length > 0
    || weightValue !== weightBaseline
    || fallbackSelectedSavedListItems.length > 0
    || customTargetsChanged;
  const { setHasUnsavedPreview } = useUnsavedPreview();
  useEffect(() => {
    setHasUnsavedPreview(isDirty);
  }, [isDirty, setHasUnsavedPreview]);
  useEffect(() => {
    return () => setHasUnsavedPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The post-save toast (see DailyReportSuccessToast) - null hides it.
  // pendingEditExit carries what's needed to leave edit mode once the
  // toast's own timer elapses (see the effect below); null for a
  // non-editing save, which never needs to navigate anywhere. State, not a
  // ref - it's written during the render-time state adjustment just below,
  // which is a lint error for a ref (react-hooks/refs) since refs are only
  // ever meant to be written from an effect or event handler.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pendingEditExit, setPendingEditExit] = useState<{ date?: string; highlightId?: string } | null>(null);

  /** "Conclude & Report" both saves and starts a fresh conversation - the
   * chat is a scratchpad for composing one report, not a running log, so
   * once it's been translated and added to the list there's nothing left
   * to keep. Adjusted during render (React's documented pattern for
   * resetting state in response to a value change) rather than in an
   * effect, and keyed on the `state` object itself (not state.success'
   * text) since useActionState returns a new object on every action call
   * even when two consecutive successes produce the exact same message.
   * An edit-save used to redirect (a real navigation, off ?edit=) instead
   * of reaching this block at all - it returns a plain state now (see
   * saveDailyReportAction's own comment on why), so this branches: a fresh
   * save still resets the scratchpad in place immediately, but an edit
   * leaves the form/URL alone here and only queues the exit for the effect
   * below, timed to the toast rather than firing right away. */
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      setToastMessage(state.success);
      if (state.wasEditing) {
        setPendingEditExit({ date: selectedDateParam, highlightId: state.savedReportId });
      } else {
        setPendingEditExit(null);
        setReportText("");
        setReportAtValue(buildReportAtValueForSelectedDate(selectedDateParam));
        setChatResetKey((key) => key + 1);
        setFallbackSelectedSavedListItems([]);
        // weightValue/customTargetValues themselves are intentionally NOT
        // reset above (see weightValue's own comment) - only the baselines
        // they're compared against advance, so this save no longer reads as
        // an unsaved edit going forward. customTargetValues staying put is
        // also what keeps e.g. today's just-saved Sleep duration visibly
        // shown in its field instead of going blank right after saving.
        setWeightBaseline(weightValue);
        setCustomTargetsBaseline(customTargetValues);
      }
    }
  }

  // Auto-dismisses the toast, and - for an edit-save - performs the
  // delayed exit from edit mode queued above: router.replace with
  // { scroll: false } instead of the old server redirect() (which resets
  // scroll to the top of the page by default, with no way to opt out -
  // reported as "the save banner scrolls me to the top of the page").
  // Delaying this until the toast's own duration has elapsed (rather than
  // firing immediately) is what keeps the page from moving at all for
  // those first two seconds - editingReport becoming null once this does
  // fire changes this form's own key in page.tsx and remounts it, which
  // would otherwise cut the toast short by clearing this very timer.
  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = setTimeout(() => {
      setToastMessage(null);
      if (pendingEditExit) {
        const params = new URLSearchParams();
        if (pendingEditExit.date) params.set("date", pendingEditExit.date);
        if (pendingEditExit.highlightId) params.set("highlight", pendingEditExit.highlightId);
        const query = params.toString();
        router.replace(`/app/daily-report${query ? `?${query}` : ""}`, { scroll: false });
      }
    }, SAVE_TOAST_DURATION_MS);
    return () => clearTimeout(timeoutId);
  }, [toastMessage, pendingEditExit, router]);

  function handleTranscriptChange(text: string) {
    setReportText(text.slice(0, REPORT_MAX_LENGTH));
  }

  const reportLength = reportText.length;
  const reportCharsLeft = REPORT_MAX_LENGTH - reportLength;

  return (
    // id: the mobile chat sheet is portaled straight to document.body (see
    // DailyReportChatPanel) so its position:fixed positioning can't be
    // affected by however deeply nested it used to be in this form - its
    // form-associated fields (checkboxes, the save button) reconnect to
    // this exact form via the standard HTML `form="daily-report-form"`
    // attribute instead of relying on DOM ancestry.
    <form id="daily-report-form" ref={formRef} action={formAction} onSubmit={handleFormSubmit} className="mt-4 space-y-3">
      <DailyReportSuccessToast locale={locale} message={toastMessage} />
      {/* Portaled to document.body (gated on isMounted - same pattern as
          the Weight/Sleep portal above) rather than rendered in place: this
          whole form sits inside a `hidden` (below `sm`) wrapper section on
          the daily-report page (see its own comment on why), so anything
          fixed-positioned rendered directly here - a modal included - would
          be trapped invisible behind that `display:none` ancestor on mobile
          no matter its own z-index or `fixed` positioning. That's what let
          a real bug through: the out-of-range confirmation below silently
          never appeared on mobile, so the click that triggered it (which
          had already flipped the floating save icon's spinner on) just sat
          spinning with nothing on screen to confirm or cancel, until the
          20-second safety timeout in DailyReportChatPanel finally cleared
          it - reading as "the save hung and did nothing." TargetsStaleModal
          had the exact same latent bug already, fixed here too. */}
      {isMounted && (state.targetsStaleChanges?.length || pendingRangeConfirm)
        ? createPortal(
            // dir set explicitly - the app only applies dir="rtl"/"ltr" on a
            // wrapper <div> inside app/app/layout.tsx, not on <html>/<body>,
            // so a portal straight to document.body escapes it and falls
            // back to the document's default LTR direction (same root cause
            // found and fixed for the daily-report chat panel's own mobile
            // sheet/dialogs).
            <div dir={directionForLocale(locale)}>
              {state.targetsStaleChanges?.length ? (
                <TargetsStaleModal locale={locale} changes={state.targetsStaleChanges} />
              ) : null}

              {pendingRangeConfirm ? (
                // z-[60]: same reasoning as TargetsStaleModal - above the
                // floating chat bubble/save icon (both z-50).
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
                  <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
                    <div className="px-5 py-4">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {tr(
                          locale,
                          `Are you sure you want to report ${pendingRangeConfirm.value} hours for "${pendingRangeConfirm.target.label}"?`,
                          `האם אתה בטוח שברצונך לדווח ${pendingRangeConfirm.value} שעות עבור "${pendingRangeConfirm.target.label}"?`,
                        )}
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setPendingRangeConfirm(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        {tr(locale, "Ignore", "התעלם")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingRangeConfirm(null);
                          bypassRangeConfirmRef.current = true;
                          formRef.current?.requestSubmit();
                        }}
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
                      >
                        {tr(locale, "Save", "שמירה")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {liveEditReportId ? <input type="hidden" name="edit_report_id" value={liveEditReportId} /> : null}
      {/* Lets the chat panel's Save button swap to deleteDailyReportAction
          (a plain report_id lookup, unrelated to edit_report_id above) via
          formAction when the AI confirms a "delete the whole entry" request
          - see DeleteEntrySubmitButton in daily-report-chat-panel.tsx. */}
      {liveEditReportId ? <input type="hidden" name="report_id" value={liveEditReportId} /> : null}
      {editingReport ? (
        // Carries forward whatever saved-list items originally contributed
        // to this report's totals - the picker below only lets the user
        // ADD to that set during an edit, not re-select the originals, so
        // their nutrition contribution would otherwise silently disappear
        // on save.
        editingReport.selectedDefaults.map((item) => (
          <span key={item.id}>
            <input type="hidden" name="selected_default_ids" value={item.id} />
            <input type="hidden" name={`quantity_default_${item.id}`} value={item.quantity} />
          </span>
        ))
      ) : null}
      {selectedDateParam ? <input type="hidden" name="selected_date" value={selectedDateParam} /> : null}

      {/* reportAtValue is a timezone-naive wall-clock string (e.g.
          "2026-08-30T23:30") with no offset, the same shape a native
          datetime-local input would produce. Submitting that directly
          would leave the server to guess a timezone when parsing it - and
          a server that isn't in the same timezone as the browser would
          silently misfile the entry under the wrong calendar day.
          Converting it to a real ISO instant here runs in the browser,
          where `new Date(naiveString)` correctly assumes the browser's own
          local timezone. Always rendered here regardless of where the
          visible date/time control itself lives (see below) - it's what
          actually gets submitted. */}
      <input type="hidden" name="report_at" value={reportAtValue ? new Date(reportAtValue).toISOString() : ""} />

      {/* No visible date/time picker anywhere in this form (AI or
          fallback branch) - reportAtValue is set once above, either to
          "now" on whatever day is currently being browsed (see
          buildReportAtValueForSelectedDate) for a new report, or preserved
          from editingReport.reportAt when editing an existing one, and
          that's the only timestamp a report ever gets. Date is only ever
          shown two other ways: the
          date-only navigation at the top of the daily-report page (to
          browse past days) and each already-saved entry's own displayed
          timestamp - neither is an editable control on this form. */}

      {/* Weight shares this row with every loggable custom target (e.g.
          Sleep duration) instead of pairing with date/time or getting a row
          of its own - each gets an equal flex-1 share by default (so 2
          tracked items split the row in half, 3 split it in thirds, etc.),
          with min-w-[110px] only as a floor so a share never gets crushed
          illegibly narrow on a very small screen (at which point it wraps
          to a new line instead).
          Portaled to a <div id="daily-report-quick-metrics"> the
          daily-report page renders just above the goal-bar charts, instead
          of rendering here in its old spot at the bottom of the page - same
          technique DailyReportChatPanel uses for its own mobile sheet, and
          for the same reason: these are still real fields submitted with
          this exact form, so `form="daily-report-form"` reconnects them
          regardless of where in the DOM they actually render. quickMetricsTarget
          (see its own comment above) is looked up in an effect rather than
          read straight from document.getElementById here, so this can't
          silently render nothing during the rare client-only remount where
          that direct read used to race the target div's own commit. */}
      {quickMetricsTarget
        ? createPortal(
            <>
              <label className="block min-w-[110px] flex-1">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Weight (kg)", "משקל (ק\"ג)")}</span>
                <input
                  type="number"
                  name="reported_weight_kg"
                  form="daily-report-form"
                  min="20"
                  max="400"
                  step="0.1"
                  inputMode="decimal"
                  value={weightValue}
                  onChange={(event) => {
                    setWeightValue(event.target.value);
                    // The browser's own native validation bubble (from
                    // min/max/step below) always renders in the BROWSER's
                    // own language, never this app's selected locale -
                    // reported as an English message ("round to 64.4 or
                    // 64.5") showing up while using the app in Hebrew.
                    // setCustomValidity replaces just the message text with
                    // a properly localized one; the native bubble UI/timing
                    // itself (used by handleQuickSave's reportValidity()
                    // call) is unaffected. Must be re-evaluated on every
                    // keystroke and cleared once valid again, or the field
                    // would stay stuck invalid after a later correction.
                    const el = event.currentTarget;
                    if (el.validity.rangeUnderflow || el.validity.rangeOverflow) {
                      el.setCustomValidity(tr(locale, "Weight must be between 20 and 400 kg.", "המשקל חייב להיות בין 20 ל-400 ק\"ג."));
                    } else if (el.validity.stepMismatch) {
                      el.setCustomValidity(
                        tr(locale, "Please enter weight to one decimal place (e.g. 63.1).", "יש להזין משקל עם ספרה עשרונית אחת (למשל 63.1)."),
                      );
                    } else if (el.validity.badInput) {
                      el.setCustomValidity(tr(locale, "Please enter a valid number.", "יש להזין מספר תקין."));
                    } else {
                      el.setCustomValidity("");
                    }
                  }}
                  placeholder={
                    initialWeightValue
                      ? tr(locale, `Current: ${initialWeightValue}`, `נוכחי: ${initialWeightValue}`)
                      : tr(locale, "e.g. 63.8", "לדוגמה: 63.8")
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
              <input type="hidden" name="changed_custom_target_ids" form="daily-report-form" value={changedCustomTargetIds.join(",")} />
              {customTargets.map((target) => (
                <label key={target.id} className="block min-w-[110px] flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {target.label} ({formatMeasurementUnit(target.unit, locale)})
                  </span>
                  <input
                    type="number"
                    name={`custom_target_value__${target.id}`}
                    form="daily-report-form"
                    step="any"
                    inputMode="decimal"
                    value={customTargetValues[target.id] ?? ""}
                    placeholder={tr(locale, "Optional", "לא חובה")}
                    onChange={(event) =>
                      setCustomTargetValues((prev) => ({ ...prev, [target.id]: event.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900"
                  />
                </label>
              ))}
            </>,
            quickMetricsTarget,
          )
        : null}

      {aiAvailable ? (
        <div className="block">
          {/* Hidden below `sm`, where the panel itself collapses behind a
              floating bubble (see DailyReportChatPanel) - this label would
              otherwise sit alone above nothing but a page-corner icon. The
              bubble's own sheet header repeats the "Chat about your day"
              title when opened; the char count is desktop-only since it's
              only really useful while watching the thread build up inline. */}
          <div className="mb-1 hidden items-center justify-between gap-2 sm:flex">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {tr(locale, "Chat about your day", "צ'אט על היום שלך")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {reportCharsLeft} {tr(locale, "characters left", "תווים נותרו")}
            </span>
          </div>
          <DailyReportChatPanel
            key={chatResetKey}
            locale={locale}
            defaultItems={defaultItems}
            onTranscriptChange={handleTranscriptChange}
            saveError={state.error}
            saveSuccess={state.success}
            bmiWarning={state.bmiWarning}
            initialTranscriptText={editingReport?.rawReportText}
            isEditing={Boolean(liveEditReportId)}
            editingReportId={liveEditReportId ?? undefined}
            editingEntrySummary={editingReport?.itemsSummaryText}
            hasChanges={isDirty}
            saveBlockedSignal={saveBlockedSignal}
            userFirstName={userFirstName}
            userGender={userGender}
          />
          <textarea name="report_text" value={reportText} readOnly hidden />
          <input type="hidden" name="parse_mode" value="ai" />
        </div>
      ) : (
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="daily-report-text" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {tr(locale, "Daily report (free text, optional)", "דיווח יומי (טקסט חופשי, אופציונלי)")}
            </label>
            <DailyReportDefaultsPicker
              locale={locale}
              defaultItems={defaultItems}
              onSelectionChange={setFallbackSelectedSavedListItems}
            />
          </div>
          {fallbackSelectedSavedListItems.length ? (
            <p className="mb-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              {tr(locale, "From your saved list", "מהרשימה השמורה")}:{" "}
              {fallbackSelectedSavedListItems
                .map((item) => `${item.name} (${item.quantity} ${formatDefaultUnit(item.unit, locale)})`)
                .join(", ")}
            </p>
          ) : null}
          <textarea
            id="daily-report-text"
            name="report_text"
            maxLength={REPORT_MAX_LENGTH}
            rows={5}
            value={reportText}
            onChange={(event) => setReportText(event.target.value)}
            placeholder={tr(
              locale,
              "Optional. Example: I ate 1 apple and 2 boiled eggs, drank 1 cup of water, and did 45 minutes of full body strength exercise.",
              "אופציונלי. לדוגמה: אכלתי תפוח אחד ושתי ביצים קשות, שתיתי כוס מים וביצעתי 45 דקות אימון כוח.",
            )}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">
              {tr(
                locale,
                "AI mode (chat and photos) is currently unavailable in this environment - you can still save using free text or your saved list.",
                "מצב AI (צ'אט ותמונות) אינו זמין כרגע בסביבה זו - עדיין ניתן לשמור באמצעות טקסט חופשי או הרשימה השמורה.",
              )}
            </span>
            <span className={reportCharsLeft < 150 ? "font-medium text-amber-700 dark:text-amber-400" : "text-slate-500 dark:text-slate-400"}>
              {reportCharsLeft} {tr(locale, "characters left", "תווים נותרו")}
            </span>
          </div>
          <input type="hidden" name="parse_mode" value="heuristic" />

          {state.error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
              {state.success}
            </p>
          ) : null}
          {state.bmiWarning ? (
            <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 dark:border-rose-800 dark:bg-rose-950/30">
              <p className="text-sm font-semibold text-rose-900 dark:text-rose-300">
                {tr(locale, "Your weight is outside the healthy BMI range", "המשקל שלך מחוץ לטווח ה-BMI הבריא")}
              </p>
              <p className="mt-1 text-sm text-rose-800 dark:text-rose-400">{state.bmiWarning}</p>
            </div>
          ) : null}

          <div className="mt-3">
            <SubmitButton locale={locale} isEditing={Boolean(liveEditReportId)} />
          </div>
        </div>
      )}
    </form>
  );
}
