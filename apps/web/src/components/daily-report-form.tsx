"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  saveDailyReportAction,
  type DailyReportActionState,
} from "@/app/app/daily-report/actions";
import { DailyReportChatPanel } from "@/components/daily-report-chat-panel";
import type { AppLocale } from "@/lib/locale";
import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, tr } from "@/lib/locale";

const initialState: DailyReportActionState = {};

type DailyReportDefaultItem = {
  id: string;
  name: string;
  kind: "food" | "hydration" | "exercise" | "custom";
  default_quantity: number;
  default_unit: string;
  is_active: boolean;
};

const REPORT_MAX_LENGTH = 2000;

function kindLabel(kind: DailyReportDefaultItem["kind"], locale: AppLocale): string {
  return formatDefaultItemKind(kind, locale);
}

function kindBadgeClass(kind: DailyReportDefaultItem["kind"]): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

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
      {pending ? tr(locale, "Saving report...", "שומר דיווח...") : tr(locale, "Save daily report", "שמירת דיווח יומי")}
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
  const defaultsSearchInputRef = useRef<HTMLInputElement | null>(null);
  const defaultsGridRef = useRef<HTMLDivElement | null>(null);
  const defaultsSelectedCountRef = useRef<HTMLSpanElement | null>(null);
  const selectAllDefaultsButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearDefaultsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [reportAtValue, setReportAtValue] = useState(() => getLocalDateTimeValue(new Date()));

  function handleTranscriptChange(text: string) {
    setReportText(text.slice(0, REPORT_MAX_LENGTH));
  }

  /**
   * The "selected" counter, quantity-input enable/disable, and each row's
   * checked-state ring highlight are all synced natively from the real DOM
   * checkbox state rather than React state, for the same reason as the
   * search filter below: a real click's change event isn't guaranteed to
   * reach a React onChange handler in this dev environment, but the
   * checkbox's own native `checked` property always updates correctly (and
   * is what the browser actually submits), so UI feedback is driven off of
   * that instead.
   */
  const syncDefaultsSelectionUi = useCallback(() => {
    const grid = defaultsGridRef.current;
    if (!grid) return;

    const checkboxes = grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]');
    let checkedCount = 0;
    checkboxes.forEach((checkbox) => {
      // Highlight goes on the <label> itself (a static className, never
      // React-controlled) rather than the outer row div, so the box the
      // user actually sees change color is the one that visually reflects
      // "selected".
      const labelEl = checkbox.closest<HTMLElement>("label");
      labelEl?.classList.toggle("ring-2", checkbox.checked);
      labelEl?.classList.toggle("ring-teal-100", checkbox.checked);
      labelEl?.classList.toggle("border-teal-300", checkbox.checked);
      const row = checkbox.closest<HTMLElement>("[data-default-name]");
      const quantityInput = row?.querySelector<HTMLInputElement>('input[type="number"]');
      if (quantityInput) quantityInput.disabled = !checkbox.checked;
      if (checkbox.checked) checkedCount += 1;
    });

    if (defaultsSelectedCountRef.current) {
      defaultsSelectedCountRef.current.textContent = String(checkedCount);
    }
  }, []);

  const setAllDefaultsChecked = useCallback((checked: boolean) => {
    const grid = defaultsGridRef.current;
    if (!grid) return;
    grid.querySelectorAll<HTMLInputElement>('input[name="selected_default_ids"]').forEach((checkbox) => {
      checkbox.checked = checked;
    });
    syncDefaultsSelectionUi();
  }, [syncDefaultsSelectionUi]);

  // Native (non-React-driven) sync for the defaults checkbox grid. Runs once
  // on mount to reflect any browser-restored checkbox state (e.g.
  // back/forward navigation), and again on every subsequent change.
  useEffect(() => {
    const grid = defaultsGridRef.current;
    if (!grid) return;

    grid.addEventListener("change", syncDefaultsSelectionUi);
    syncDefaultsSelectionUi();
    return () => grid.removeEventListener("change", syncDefaultsSelectionUi);
  }, [syncDefaultsSelectionUi]);

  // "Select all" / "Clear" are wired via native addEventListener rather than
  // React's onClick, for the same reason as the checkbox grid: a real click's
  // event isn't guaranteed to reach a React synthetic handler in this dev
  // environment, even though the handler itself is otherwise state-free.
  useEffect(() => {
    const selectAllButton = selectAllDefaultsButtonRef.current;
    const clearButton = clearDefaultsButtonRef.current;
    if (!selectAllButton || !clearButton) return;

    const handleSelectAll = () => setAllDefaultsChecked(true);
    const handleClear = () => setAllDefaultsChecked(false);

    selectAllButton.addEventListener("click", handleSelectAll);
    clearButton.addEventListener("click", handleClear);
    return () => {
      selectAllButton.removeEventListener("click", handleSelectAll);
      clearButton.removeEventListener("click", handleClear);
    };
  }, [setAllDefaultsChecked]);

  // A native (non-React-driven) filter for the defaults search box: a plain
  // DOM `input` listener toggling each row's visibility directly, rather
  // than React state gating a `.filter()` in the render. This must not
  // depend on React's onChange firing for a real keystroke.
  useEffect(() => {
    const input = defaultsSearchInputRef.current;
    const grid = defaultsGridRef.current;
    if (!input || !grid) return;

    function handleInput() {
      const query = (input!.value || "").trim().toLowerCase();
      const rows = grid!.querySelectorAll<HTMLElement>("[data-default-name]");
      rows.forEach((row) => {
        const name = row.dataset.defaultName ?? "";
        row.classList.toggle("hidden", query.length > 0 && !name.includes(query));
      });
    }

    input.addEventListener("input", handleInput);
    return () => input.removeEventListener("input", handleInput);
  }, []);

  const reportLength = reportText.length;
  const reportCharsLeft = REPORT_MAX_LENGTH - reportLength;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="block flex-1 min-w-[180px]">
          <span className="mb-1 block text-xs font-medium text-slate-600">{tr(locale, "Date & time", "תאריך ושעה")}</span>
          <input
            type="datetime-local"
            name="report_at"
            value={reportAtValue}
            onChange={(event) => setReportAtValue(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
          />
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
          <DailyReportChatPanel locale={locale} onTranscriptChange={handleTranscriptChange} />
          <textarea name="report_text" value={reportText} readOnly hidden />
          <input type="hidden" name="parse_mode" value="ai" />
        </div>
      ) : (
        <div className="block">
          <label htmlFor="daily-report-text" className="mb-1 block text-sm font-medium text-slate-700">
            {tr(locale, "Daily report (free text, optional)", "דיווח יומי (טקסט חופשי, אופציונלי)")}
          </label>
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

      {defaultItems.length ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">{tr(locale, "Quick defaults", "ברירות מחדל מהירות")}</h3>
              <p className="mt-1 text-xs text-slate-600">
                {tr(locale, "Check items to include them in this report. Adjust quantity if needed.", "סמן פריטים כדי לכלול אותם בדיווח. אפשר להתאים כמות לפי הצורך.")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                <span ref={defaultsSelectedCountRef}>0</span> {tr(locale, "selected", "נבחרו")}
              </span>
              <button
                type="button"
                ref={selectAllDefaultsButtonRef}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {tr(locale, "Select all", "בחירת הכל")}
              </button>
              <button
                type="button"
                ref={clearDefaultsButtonRef}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {tr(locale, "Clear", "ניקוי")}
              </button>
            </div>
          </div>

          {defaultItems.length > 5 ? (
            <input
              ref={defaultsSearchInputRef}
              type="text"
              defaultValue=""
              placeholder={tr(locale, "Search your defaults...", "חיפוש בברירות המחדל שלך...")}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-teal-600 focus:ring-2"
            />
          ) : null}

          <div ref={defaultsGridRef} className="mt-3 grid gap-2 sm:grid-cols-2">
            {defaultItems.map((item) => {
              return (
                // Neither this row div's nor the label's className is
                // React-controlled (no state-dependent expression), so the
                // search filter's and selection sync's imperative
                // classList.toggle(...) calls survive re-renders instead of
                // being overwritten by React reconciling a declarative
                // className back onto these nodes.
                <div key={item.id} data-default-name={formatDefaultItemName(item.name, locale).toLowerCase()}>
                <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        name="selected_default_ids"
                        value={item.id}
                        defaultChecked={false}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium text-slate-800">{formatDefaultItemName(item.name, locale)}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {tr(locale, "Default", "ברירת מחדל")}: {item.default_quantity} {formatDefaultUnit(item.default_unit, locale)}
                        </span>
                      </span>
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${kindBadgeClass(item.kind)}`}>
                      {kindLabel(item.kind, locale)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-slate-600">{tr(locale, "Quantity", "כמות")}</span>
                    <input
                      name={`quantity_default_${item.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={item.default_quantity}
                      disabled
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </label>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

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
