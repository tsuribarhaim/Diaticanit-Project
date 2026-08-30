"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}: {
  defaultItems: DailyReportDefaultItem[];
  aiAvailable: boolean;
  locale: AppLocale;
}) {
  const [state, formAction] = useActionState(saveDailyReportAction, initialState);
  const [reportText, setReportText] = useState("");
  const [entryMode, setEntryMode] = useState<"quick" | "chat">("quick");
  const defaultsSearchInputRef = useRef<HTMLInputElement | null>(null);
  const defaultsGridRef = useRef<HTMLDivElement | null>(null);
  const defaultsSelectedCountRef = useRef<HTMLSpanElement | null>(null);
  const selectAllDefaultsButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearDefaultsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [reportAtValue, setReportAtValue] = useState("");
  const [mealPhotoPreview, setMealPhotoPreview] = useState<string | null>(null);
  const [mealPhotoName, setMealPhotoName] = useState<string | null>(null);
  const mealPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const mealPhotoGalleryInputRef = useRef<HTMLInputElement | null>(null);
  const currentLocalDateTime = useMemo(() => getLocalDateTimeValue(new Date()), []);

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

  function handleMealPhotoChange(file: File | null) {
    setMealPhotoPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return file ? URL.createObjectURL(file) : null;
    });
    setMealPhotoName(file ? file.name : null);
  }

  /**
   * The "choose from gallery/files" input intentionally has no `name` of its
   * own, since a second same-named file input would add a second, empty
   * FormData entry that could shadow the real one. Instead, its selection is
   * copied into the canonical meal_photo input via DataTransfer so form
   * submission always reads the right file regardless of which picker the
   * user used.
   */
  function handleGalleryPhotoChange(file: File | null) {
    if (file && mealPhotoInputRef.current) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      mealPhotoInputRef.current.files = transfer.files;
    }
    handleMealPhotoChange(file);
  }

  function clearMealPhoto() {
    if (mealPhotoInputRef.current) mealPhotoInputRef.current.value = "";
    if (mealPhotoGalleryInputRef.current) mealPhotoGalleryInputRef.current.value = "";
    handleMealPhotoChange(null);
  }

  /** Chat never saves anything itself - it hands its composed description
   * back here so the exact same free-text textarea (and everything that
   * depends on it: safety gate, heuristic/AI parsing, save action) handles
   * it exactly as if the user had typed it directly. */
  function handleLogChatEntry(composedText: string) {
    setReportText((previous) => (previous ? `${previous} ${composedText}` : composedText));
    setEntryMode("quick");
  }

  const reportLength = reportText.length;
  const reportCharsLeft = REPORT_MAX_LENGTH - reportLength;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label className="block flex-1 min-w-[220px]">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Report date and time (optional)", "תאריך ושעת דיווח (אופציונלי)")}</span>
            <input
              type="datetime-local"
              name="report_at"
              value={reportAtValue}
              onChange={(event) => setReportAtValue(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
            />
          </label>
          <label className="block flex-1 min-w-[220px]">
            <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Current weight (optional)", "משקל נוכחי (אופציונלי)")}</span>
            <input
              type="number"
              name="reported_weight_kg"
              min="20"
              max="400"
              step="0.01"
              placeholder={tr(locale, "e.g. 63.8", "לדוגמה: 63.8")}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
            />
          </label>
          <div className="flex gap-2 pb-0.5">
            <button
              type="button"
              onClick={() => setReportAtValue(currentLocalDateTime)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Use now", "השתמש עכשיו")}
            </button>
            <button
              type="button"
              onClick={() => setReportAtValue("")}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Clear time", "ניקוי זמן")}
            </button>
          </div>
        </div>
      </section>

      {aiAvailable ? (
        <div className="flex gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => setEntryMode("quick")}
            className={`rounded-lg px-3 py-1.5 ${
              entryMode === "quick" ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"
            }`}
          >
            {tr(locale, "Quick entry", "רישום מהיר")}
          </button>
          <button
            type="button"
            onClick={() => setEntryMode("chat")}
            className={`rounded-lg px-3 py-1.5 ${
              entryMode === "chat" ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"
            }`}
          >
            {tr(locale, "Chat about your day", "צ'אט על היום שלך")}
          </button>
        </div>
      ) : null}

      {entryMode === "chat" && aiAvailable ? (
        <DailyReportChatPanel locale={locale} onLogEntry={handleLogChatEntry} />
      ) : null}

      <div className={entryMode === "chat" ? "hidden" : "block"}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label htmlFor="daily-report-text" className="text-sm font-medium text-slate-700">
            {tr(locale, "Daily report (free text, optional)", "דיווח יומי (טקסט חופשי, אופציונלי)")}
          </label>
          <div className="flex shrink-0 items-center gap-1.5">
            <label
              htmlFor="meal-photo-input"
              aria-label={tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")}
              title={
                aiAvailable
                  ? tr(locale, "Take a photo of your plate", "צילום תמונה של הצלחת")
                  : tr(locale, "AI mode is currently unavailable in this environment.", "מצב AI אינו זמין כרגע בסביבה זו.")
              }
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-teal-300 text-teal-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600 ${
                aiAvailable ? "cursor-pointer hover:bg-teal-50" : "cursor-not-allowed opacity-50"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M9 3h6l1.5 3H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5L9 3Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </label>
            <label
              htmlFor="meal-photo-gallery-input"
              aria-label={tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")}
              title={
                aiAvailable
                  ? tr(locale, "Choose an existing photo or file", "בחירת תמונה או קובץ קיים")
                  : tr(locale, "AI mode is currently unavailable in this environment.", "מצב AI אינו זמין כרגע בסביבה זו.")
              }
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-teal-300 text-teal-700 focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-600 ${
                aiAvailable ? "cursor-pointer hover:bg-teal-50" : "cursor-not-allowed opacity-50"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </label>
          </div>
        </div>
        <input
          ref={mealPhotoGalleryInputRef}
          id="meal-photo-gallery-input"
          type="file"
          accept="image/*"
          disabled={!aiAvailable}
          onChange={(event) => handleGalleryPhotoChange(event.target.files?.[0] ?? null)}
          className="sr-only"
        />
        <input
          ref={mealPhotoInputRef}
          id="meal-photo-input"
          type="file"
          name="meal_photo"
          accept="image/*"
          capture="environment"
          disabled={!aiAvailable}
          onChange={(event) => handleMealPhotoChange(event.target.files?.[0] ?? null)}
          className="sr-only"
        />
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
          <span className="text-slate-500">{tr(locale, "You can save using free text, a plate photo, defaults, or a combination.", "אפשר לשמור באמצעות טקסט חופשי, תמונת צלחת, ברירות מחדל, או שילוב ביניהם.")}</span>
          <span className={reportCharsLeft < 150 ? "font-medium text-amber-700" : "text-slate-500"}>
            {reportCharsLeft} {tr(locale, "characters left", "תווים נותרו")}
          </span>
        </div>

        {mealPhotoPreview ? (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-teal-200 bg-teal-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mealPhotoPreview} alt="" className="h-16 w-16 rounded-md border border-teal-200 object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-teal-900">{mealPhotoName}</p>
              <p className="mt-0.5 text-xs text-teal-700">
                {tr(
                  locale,
                  "This photo will be analyzed by AI for nutrients when you save - review the estimate before confirming.",
                  "תמונה זו תנותח על ידי AI לערכים תזונתיים בעת השמירה - יש לבדוק את ההערכה לפני האישור.",
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={clearMealPhoto}
              aria-label={tr(locale, "Remove photo", "הסרת תמונה")}
              className="shrink-0 rounded-full border border-teal-300 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-100"
            >
              {tr(locale, "Remove", "הסרה")}
            </button>
          </div>
        ) : null}
      </div>

      <section
        className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${mealPhotoPreview ? "opacity-60" : ""} ${
          entryMode === "chat" ? "hidden" : ""
        }`}
      >
        <h3 className="text-sm font-semibold text-slate-800">{tr(locale, "Translation mode", "מצב תרגום")}</h3>
        <p className="mt-1 text-xs text-slate-600">
          {mealPhotoPreview
            ? tr(
                locale,
                "A photo is attached, so it will be analyzed by AI regardless of the mode below.",
                "תמונה מצורפת, ולכן היא תנותח על ידי AI ללא קשר למצב שלמטה.",
              )
            : tr(
                locale,
                "Choose how free-text input is translated into structured nutrition and exercise values.",
                "בחרו כיצד טקסט חופשי יתורגם לערכים מובנים של תזונה ופעילות.",
              )}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50">
            <span className="flex items-start gap-2">
              <input
                type="radio"
                name="parse_mode"
                value="heuristic"
                defaultChecked
                disabled={Boolean(mealPhotoPreview)}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              <span>
                <span className="block font-medium text-slate-800">{tr(locale, "Heuristic", "יוריסטי")}</span>
                <span className="mt-0.5 block text-xs text-slate-600">{tr(locale, "Fast deterministic parser. Best for common phrases.", "מנוע דטרמיניסטי מהיר. מתאים במיוחד לניסוחים נפוצים.")}</span>
              </span>
            </span>
          </label>
          <label
            className={`rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm has-[:checked]:border-teal-300 has-[:checked]:bg-teal-50 ${!aiAvailable ? "opacity-70" : ""}`}
          >
            <span className="flex items-start gap-2">
              <input
                type="radio"
                name="parse_mode"
                value="ai"
                disabled={!aiAvailable || Boolean(mealPhotoPreview)}
                className="mt-0.5 h-4 w-4 accent-teal-700"
              />
              <span>
                <span className="block font-medium text-slate-800">AI</span>
                <span className="mt-0.5 block text-xs text-slate-600">{tr(locale, "Better for complex phrasing and mixed context.", "מתאים יותר לניסוחים מורכבים והקשר מעורב.")}</span>
                {!aiAvailable ? (
                  <span className="mt-1 block text-xs font-medium text-amber-700">
                    {tr(locale, "AI mode is currently unavailable in this environment.", "מצב AI אינו זמין כרגע בסביבה זו.")}
                  </span>
                ) : null}
              </span>
            </span>
          </label>
        </div>
      </section>

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
