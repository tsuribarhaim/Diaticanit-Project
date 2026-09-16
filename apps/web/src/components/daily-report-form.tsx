"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";

import {
  saveDailyReportAction,
  type DailyReportActionState,
} from "@/app/app/daily-report/actions";
import { DailyReportChatPanel, type DailyReportDefaultItem } from "@/components/daily-report-chat-panel";
import { DailyReportDefaultsPicker, type SelectedSavedListItem } from "@/components/daily-report-defaults-picker";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { TargetsStaleModal } from "@/components/targets-stale-modal";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { formatDefaultUnit, formatMeasurementUnit, tr, type AppLocale } from "@/lib/locale";

const initialState: DailyReportActionState = {};

/**
 * True only once the client has actually mounted - used below to gate the
 * Weight/Sleep portal's document.getElementById lookup. Prefer this over a
 * one-shot inline `typeof document !== "undefined"` check: that check can
 * run correctly in theory, but nothing then forces a second render if the
 * very first pass somehow missed the target (React 19's hydration timing
 * isn't something to gamble a silently-missing form section on) -
 * useSyncExternalStore's whole job is guaranteeing a real, correctly-timed
 * re-render once the client value differs from the server one, which is
 * exactly the "definitely mounted, DOM is definitely real now" signal
 * needed here. subscribe is a no-op since nothing ever un-mounts this true.
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

function getLocalDateTimeValue(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const offsetMs = copy.getTimezoneOffset() * 60_000;
  return new Date(copy.getTime() - offsetMs).toISOString().slice(0, 16);
}

export type LoggableCustomTarget = { id: string; label: string; unit: string };

export type EditingDailyReport = {
  id: string;
  rawReportText: string;
  reportedWeightKg: number | null;
  reportAt: string;
  selectedDefaults: Array<{ id: string; quantity: number }>;
  customTargetValues: Record<string, number>;
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
  const liveEditReportId = useSearchParams().get("edit");
  const [state, formAction] = useActionState(saveDailyReportAction, initialState);
  const [reportText, setReportText] = useState(() => editingReport?.rawReportText ?? "");
  const [chatResetKey, setChatResetKey] = useState(0);
  const [reportAtValue, setReportAtValue] = useState(() =>
    editingReport ? toLocalDateTimeValue(editingReport.reportAt) : getLocalDateTimeValue(new Date()),
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
  // Gates the Weight/Sleep portal lookup below until the client has
  // definitely mounted - see subscribeMounted's comment above.
  const isMounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerMountedSnapshot);

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

  /** "Conclude & Report" both saves and starts a fresh conversation - the
   * chat is a scratchpad for composing one report, not a running log, so
   * once it's been translated and added to the list there's nothing left
   * to keep. Adjusted during render (React's documented pattern for
   * resetting state in response to a value change) rather than in an
   * effect, and keyed on the `state` object itself (not state.success'
   * text) since useActionState returns a new object on every action call
   * even when two consecutive successes produce the exact same message. */
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      setReportText("");
      setReportAtValue(getLocalDateTimeValue(new Date()));
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
            <>
              {state.targetsStaleChanges?.length ? (
                <TargetsStaleModal locale={locale} changes={state.targetsStaleChanges} />
              ) : null}

              {pendingRangeConfirm ? (
                // z-[60]: same reasoning as TargetsStaleModal - above the
                // floating chat bubble/save icon (both z-50).
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
                  <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
                    <div className="px-5 py-4">
                      <p className="text-sm text-slate-700">
                        {tr(
                          locale,
                          `Are you sure you want to report ${pendingRangeConfirm.value} hours for "${pendingRangeConfirm.target.label}"?`,
                          `האם אתה בטוח שברצונך לדווח ${pendingRangeConfirm.value} שעות עבור "${pendingRangeConfirm.target.label}"?`,
                        )}
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                      <button
                        type="button"
                        onClick={() => setPendingRangeConfirm(null)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
                        className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
                      >
                        {tr(locale, "Save", "שמירה")}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}

      {liveEditReportId ? <input type="hidden" name="edit_report_id" value={liveEditReportId} /> : null}
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
          "now" for a new report or preserved from editingReport.reportAt
          when editing an existing one, and that's the only timestamp a
          report ever gets. Date is only ever shown two other ways: the
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
          regardless of where in the DOM they actually render. The target
          div always exists (the page renders it unconditionally), so unlike
          the chat panel's viewport-dependent portal, this one has nothing
          to wait on. */}
      {isMounted && document.getElementById("daily-report-quick-metrics")
        ? createPortal(
            <>
              <label className="block min-w-[110px] flex-1">
                <span className="mb-1 block text-xs font-medium text-slate-600">{tr(locale, "Weight (kg)", "משקל (ק\"ג)")}</span>
                <input
                  type="number"
                  name="reported_weight_kg"
                  form="daily-report-form"
                  min="20"
                  max="400"
                  step="0.1"
                  inputMode="decimal"
                  value={weightValue}
                  onChange={(event) => setWeightValue(event.target.value)}
                  placeholder={
                    initialWeightValue
                      ? tr(locale, `Current: ${initialWeightValue}`, `נוכחי: ${initialWeightValue}`)
                      : tr(locale, "e.g. 63.8", "לדוגמה: 63.8")
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
                />
                {weightValue.trim() ? (
                  <p className="mt-1 text-xs text-teal-700">
                    {tr(
                      locale,
                      "This will be recorded as today's weight when you conclude & report.",
                      "המשקל הזה יירשם כמשקל של היום עם סיום ודיווח.",
                    )}
                  </p>
                ) : null}
              </label>
              {customTargets.map((target) => (
                <label key={target.id} className="block min-w-[110px] flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
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
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
                  />
                </label>
              ))}
            </>,
            document.getElementById("daily-report-quick-metrics")!,
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
            <span className="text-sm font-medium text-slate-700">
              {tr(locale, "Chat about your day", "צ'אט על היום שלך")}
            </span>
            <span className="text-xs text-slate-500">
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
            hasChanges={isDirty}
            saveBlockedSignal={saveBlockedSignal}
          />
          <textarea name="report_text" value={reportText} readOnly hidden />
          <input type="hidden" name="parse_mode" value="ai" />
        </div>
      ) : (
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="daily-report-text" className="block text-sm font-medium text-slate-700">
              {tr(locale, "Daily report (free text, optional)", "דיווח יומי (טקסט חופשי, אופציונלי)")}
            </label>
            <DailyReportDefaultsPicker
              locale={locale}
              defaultItems={defaultItems}
              onSelectionChange={setFallbackSelectedSavedListItems}
            />
          </div>
          {fallbackSelectedSavedListItems.length ? (
            <p className="mb-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
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
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">
              {tr(
                locale,
                "AI mode (chat and photos) is currently unavailable in this environment - you can still save using free text or your saved list.",
                "מצב AI (צ'אט ותמונות) אינו זמין כרגע בסביבה זו - עדיין ניתן לשמור באמצעות טקסט חופשי או הרשימה השמורה.",
              )}
            </span>
            <span className={reportCharsLeft < 150 ? "font-medium text-amber-700" : "text-slate-500"}>
              {reportCharsLeft} {tr(locale, "characters left", "תווים נותרו")}
            </span>
          </div>
          <input type="hidden" name="parse_mode" value="heuristic" />

          {state.error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.error}
            </p>
          ) : null}
          {state.success ? (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {state.success}
            </p>
          ) : null}
          {state.bmiWarning ? (
            <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2">
              <p className="text-sm font-semibold text-rose-900">
                {tr(locale, "Your weight is outside the healthy BMI range", "המשקל שלך מחוץ לטווח ה-BMI הבריא")}
              </p>
              <p className="mt-1 text-sm text-rose-800">{state.bmiWarning}</p>
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
