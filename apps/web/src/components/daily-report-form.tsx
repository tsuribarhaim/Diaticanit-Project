"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  saveDailyReportAction,
  type DailyReportActionState,
} from "@/app/app/daily-report/actions";
import { DailyReportChatPanel, type DailyReportDefaultItem } from "@/components/daily-report-chat-panel";
import { DailyReportDefaultsPicker, type SelectedSavedListItem } from "@/components/daily-report-defaults-picker";
import { SubmitButton } from "@/components/daily-report-submit-button";
import { LocalizedDateTimeInput } from "@/components/localized-date-input";
import { TargetsStaleModal } from "@/components/targets-stale-modal";
import { useUnsavedPreview } from "@/components/unsaved-preview-context";
import { formatDefaultUnit, tr, type AppLocale } from "@/lib/locale";

const initialState: DailyReportActionState = {};

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
  const weightBaselineRef = useRef(editingWeightValue);

  // Warns before navigating away (nav bar links) once the user has typed a
  // report, entered a weight, or picked saved-list items - same guard/modal
  // already used on the Targets page. Unlike Profile/Onboarding, a
  // successful save doesn't navigate away - the form resets itself in
  // place (see the reportText/reportAtValue reset below) - so clearing on
  // state.success (handled in that same reset block) is what actually
  // matters here, not on unmount.
  const { setHasUnsavedPreview } = useUnsavedPreview();
  useEffect(() => {
    const isDirty =
      reportText.trim().length > 0 || weightValue !== weightBaselineRef.current || fallbackSelectedSavedListItems.length > 0;
    setHasUnsavedPreview(isDirty);
  }, [reportText, weightValue, fallbackSelectedSavedListItems, setHasUnsavedPreview]);
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
    }
  }
  // Refs can't be mutated during render (unlike the setState calls above,
  // which React explicitly sanctions there) - deferred to an effect keyed
  // on the same `state` transition instead. weightValue itself is read at
  // effect time, not captured as a dependency, since it's intentionally
  // NOT reset above (see weightBaselineRef's own comment) and stays current
  // by the time this runs.
  useEffect(() => {
    if (state.success) {
      weightBaselineRef.current = weightValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleTranscriptChange(text: string) {
    setReportText(text.slice(0, REPORT_MAX_LENGTH));
  }

  const reportLength = reportText.length;
  const reportCharsLeft = REPORT_MAX_LENGTH - reportLength;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      {state.targetsStaleChanges?.length ? (
        <TargetsStaleModal locale={locale} changes={state.targetsStaleChanges} />
      ) : null}

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

      <div className="flex flex-wrap gap-2">
        <label className="block flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tr(locale, "Date & time", "תאריך ושעה")}</span>
          <LocalizedDateTimeInput
            locale={locale}
            value={reportAtValue}
            onChange={setReportAtValue}
            ariaLabel={tr(locale, "Date & time", "תאריך ושעה")}
          />
          {/* reportAtValue is a timezone-naive wall-clock string (e.g.
              "2026-08-30T23:30") with no offset, the same shape a native
              datetime-local input would produce. Submitting that
              directly would leave the server to guess a timezone when
              parsing it - and a server that isn't in the same timezone as
              the browser would silently misfile the entry under the wrong
              calendar day. Converting it to a real ISO instant here runs
              in the browser, where `new Date(naiveString)` correctly
              assumes the browser's own local timezone. */}
          <input type="hidden" name="report_at" value={reportAtValue ? new Date(reportAtValue).toISOString() : ""} />
        </label>
        <label className="block flex-1 min-w-[140px]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tr(locale, "Weight (kg)", "משקל (ק\"ג)")}</span>
          <input
            type="number"
            name="reported_weight_kg"
            min="20"
            max="400"
            step="0.1"
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
      </div>

      {customTargets.length ? (
        <div className="flex flex-wrap gap-2">
          {customTargets.map((target) => (
            <label key={target.id} className="block flex-1 min-w-[140px]">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {target.label} ({target.unit})
              </span>
              <input
                type="number"
                name={`custom_target_value__${target.id}`}
                step="any"
                defaultValue={editingReport?.customTargetValues[target.id] ?? ""}
                placeholder={tr(locale, "Optional", "לא חובה")}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
              />
            </label>
          ))}
        </div>
      ) : null}

      {aiAvailable ? (
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-2">
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
