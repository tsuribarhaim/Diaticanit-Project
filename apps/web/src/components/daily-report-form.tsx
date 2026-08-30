"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveDailyReportAction,
  type DailyReportActionState,
} from "@/app/app/daily-report/actions";
import { DailyReportChatPanel, type DailyReportDefaultItem } from "@/components/daily-report-chat-panel";
import { DailyReportDefaultsPicker } from "@/components/daily-report-defaults-picker";
import type { AppLocale } from "@/lib/locale";
import { tr } from "@/lib/locale";

const initialState: DailyReportActionState = {};

const REPORT_MAX_LENGTH = 2000;

function getLocalDateTimeValue(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  const offsetMs = copy.getTimezoneOffset() * 60_000;
  return new Date(copy.getTime() - offsetMs).toISOString().slice(0, 16);
}

function SubmitButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Saving...", "שומר...") : tr(locale, "Conclude & Report", "סיום ודיווח")}
    </button>
  );
}

export function DailyReportForm({
  defaultItems,
  aiAvailable,
  locale,
  currentWeightKg,
}: {
  defaultItems: DailyReportDefaultItem[];
  aiAvailable: boolean;
  locale: AppLocale;
  currentWeightKg?: number | null;
}) {
  const [state, formAction] = useActionState(saveDailyReportAction, initialState);
  const [reportText, setReportText] = useState("");
  const [chatResetKey, setChatResetKey] = useState(0);
  const [reportAtValue, setReportAtValue] = useState(() => getLocalDateTimeValue(new Date()));
  const [fallbackDefaultsSummary, setFallbackDefaultsSummary] = useState<string[]>([]);

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
    }
  }

  function handleTranscriptChange(text: string) {
    setReportText(text.slice(0, REPORT_MAX_LENGTH));
  }

  const reportLength = reportText.length;
  const reportCharsLeft = REPORT_MAX_LENGTH - reportLength;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="block flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tr(locale, "Date & time", "תאריך ושעה")}</span>
          <input
            type="datetime-local"
            value={reportAtValue}
            onChange={(event) => setReportAtValue(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
          />
          {/* datetime-local's value is a timezone-naive wall-clock string
              (e.g. "2026-08-30T23:30") with no offset. Submitting that
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
            step="0.01"
            defaultValue={currentWeightKg ?? undefined}
            placeholder={tr(locale, "e.g. 63.8", "לדוגמה: 63.8")}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
          />
        </label>
      </div>

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
            <DailyReportDefaultsPicker locale={locale} defaultItems={defaultItems} onAdd={setFallbackDefaultsSummary} />
          </div>
          {fallbackDefaultsSummary.length ? (
            <p className="mb-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
              {tr(locale, "From defaults", "מברירות מחדל")}: {fallbackDefaultsSummary.join(", ")}
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
                "AI mode (chat and photos) is currently unavailable in this environment - you can still save using free text or defaults.",
                "מצב AI (צ'אט ותמונות) אינו זמין כרגע בסביבה זו - עדיין ניתן לשמור באמצעות טקסט חופשי או ברירות מחדל.",
              )}
            </span>
            <span className={reportCharsLeft < 150 ? "font-medium text-amber-700" : "text-slate-500"}>
              {reportCharsLeft} {tr(locale, "characters left", "תווים נותרו")}
            </span>
          </div>
          <input type="hidden" name="parse_mode" value="heuristic" />
        </div>
      )}

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <SubmitButton locale={locale} />
    </form>
  );
}
