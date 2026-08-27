import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addReportToDefaultsAction,
  confirmDailyReportAction,
  deleteDailyReportAction,
  retryDailyReportWithAiAction,
} from "@/app/app/daily-report/actions";
import { DailyReportForm } from "@/components/daily-report-form";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { formatDateTimeForLocale, formatMeasurementUnit, formatNumberForLocale, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isMissingReportedWeightColumn(errorMessage: string): boolean {
  return errorMessage.includes("reported_weight_kg") && errorMessage.includes("does not exist");
}

function formatNumber(value: number | string | null, locale: AppLocale, digits = 0): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0";
  return formatNumberForLocale(parsed, locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatConfidence(value: number | string | null, locale: AppLocale): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "0%";
  return `${formatNumberForLocale(Math.round(parsed * 100), locale)}%`;
}

function parseModeBadgeClasses(mode: string | null): string {
  if (mode === "ai") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function parseModeLabel(mode: string | null, locale: AppLocale): string {
  return mode === "ai" ? "AI" : tr(locale, "Heuristic", "יוריסטי");
}

function statusClasses(status: "green" | "yellow" | "red") {
  if (status === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "yellow") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function compareRatio(value: number, target: number): "green" | "yellow" | "red" {
  if (target <= 0) return "yellow";
  const ratio = value / target;
  if (ratio >= 1) return "green";
  if (ratio >= 0.7) return "yellow";
  return "red";
}

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const aiAvailable = Boolean(getAiExtractionConfig());

  const locale = normalizeLocale(
    (
      await supabase
        .from("user_profile")
        .select("preferred_language")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data?.preferred_language,
  );

  // Daily-report entries no longer compare against scalar targets; the active
  // target profile stores min/max ranges instead. We compare against the
  // minimum of each range here (protein_min_g / water_min_ml) as a reasonable
  // "did you hit at least the floor" signal for this simple status badge.
  const { data: activeTargetProfile } = await supabase
    .from("user_target_profiles")
    .select("id, protein_min_g, water_min_ml")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  let reportsError: Error | null = null;
  let reports:
    | Array<{
        id: string;
        raw_report_text: string | null;
        report_at: string;
        status: string;
        parse_confidence: number | null;
        parse_mode: string | null;
        parser_version: string | null;
        requires_confirmation: boolean;
        calories_kcal: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
        water_ml: number | null;
        magnesium_mg: number | null;
        potassium_mg: number | null;
        iron_mg: number | null;
        zinc_mg: number | null;
        exercise_minutes: number | null;
        estimated_burn_kcal: number | null;
        reported_weight_kg: number | null;
        parsed_items: unknown;
        parsed_exercises: unknown;
      }>
    | null = null;

  const reportsWithWeight = await supabase
    .from("user_daily_reports")
    .select(
      "id, raw_report_text, report_at, status, parse_confidence, parse_mode, parser_version, requires_confirmation, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, reported_weight_kg, parsed_items, parsed_exercises",
    )
    .eq("user_id", user.id)
    .order("report_at", { ascending: false })
    .limit(20);

  if (reportsWithWeight.error && isMissingReportedWeightColumn(reportsWithWeight.error.message)) {
    const reportsWithoutWeight = await supabase
      .from("user_daily_reports")
      .select(
        "id, raw_report_text, report_at, status, parse_confidence, parse_mode, parser_version, requires_confirmation, calories_kcal, protein_g, carbs_g, fat_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, exercise_minutes, estimated_burn_kcal, parsed_items, parsed_exercises",
      )
      .eq("user_id", user.id)
      .order("report_at", { ascending: false })
      .limit(20);

    reportsError = reportsWithoutWeight.error;
    reports = (reportsWithoutWeight.data ?? []).map((item) => ({ ...item, reported_weight_kg: null }));
  } else {
    reportsError = reportsWithWeight.error;
    reports = reportsWithWeight.data;
  }

  const { data: defaultItems } = await supabase
    .from("user_default_items")
    .select(
      "id, name, kind, default_quantity, default_unit, is_active",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (reportsError) {
    throw new Error(reportsError.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "User daily report", "דיווח יומי")}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {tr(
                locale,
                "Log food, hydration, and exercise in free text or with quick defaults. The system organizes key nutrients and activity metrics with timestamps.",
                "תעדו אוכל, שתייה ופעילות בטקסט חופשי או בעזרת ברירות מחדל. המערכת מארגנת את המדדים התזונתיים והפעילות לפי זמן.",
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/app/daily-report/defaults"
              className="rounded-lg border border-teal-300 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
            >
              {tr(locale, "Manage defaults", "ניהול ברירות מחדל")}
            </Link>
            <Link
              href="/app"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Back to dashboard", "חזרה ללוח הבקרה")}
            </Link>
          </div>
        </div>

        {resolvedSearchParams.error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {resolvedSearchParams.error}
          </p>
        ) : null}
        {resolvedSearchParams.notice ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {resolvedSearchParams.notice}
          </p>
        ) : null}

        <DailyReportForm defaultItems={defaultItems ?? []} aiAvailable={aiAvailable} locale={locale} />
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Recent entries", "רשומות אחרונות")}</h2>

        {!reports?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No reports yet. Add your first free-text daily report above.", "אין עדיין דיווחים. אפשר להוסיף דיווח יומי ראשון למעלה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {reports.map((report) => {
              const proteinStatus = activeTargetProfile?.protein_min_g
                ? compareRatio(Number(report.protein_g), Number(activeTargetProfile.protein_min_g))
                : "yellow";
              const hydrationTargetMl = activeTargetProfile?.water_min_ml
                ? Number(activeTargetProfile.water_min_ml)
                : 0;
              const hydrationStatus = hydrationTargetMl
                ? compareRatio(Number(report.water_ml), hydrationTargetMl)
                : "yellow";

              return (
                <article key={report.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatDateTimeForLocale(report.report_at, locale)}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">{tr(locale, "Confidence", "רמת ביטחון")}: {formatConfidence(report.parse_confidence, locale)}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(proteinStatus)}`}>
                        {tr(locale, "Protein", "חלבון")}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses(hydrationStatus)}`}>
                        {tr(locale, "Hydration", "נוזלים")}
                      </span>
                      {report.requires_confirmation ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          {tr(locale, "Needs confirmation", "דורש אישור")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                          {tr(locale, "Confirmed", "מאושר")}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
                    {report.raw_report_text?.trim() || tr(locale, "No free-text note provided. Entry created from selected defaults.", "לא הוזן טקסט חופשי. הרשומה נוצרה מברירות המחדל שנבחרו.")}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full border px-2.5 py-1 font-medium ${parseModeBadgeClasses(report.parse_mode)}`}>
                      {tr(locale, "Mode", "מצב")}: {parseModeLabel(report.parse_mode, locale)}
                    </span>
                    {report.parser_version ? (
                      <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700">
                        {tr(locale, "Parser", "מנוע")}: {report.parser_version}
                      </span>
                    ) : null}
                    <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700">
                      {tr(locale, "Food items", "פריטי אוכל")}: {Array.isArray(report.parsed_items) ? report.parsed_items.length : 0}
                    </span>
                    <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700">
                      {tr(locale, "Exercise items", "פריטי פעילות")}: {Array.isArray(report.parsed_exercises) ? report.parsed_exercises.length : 0}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                    <p>{tr(locale, "Reported weight", "משקל מדווח")}: <span className="font-semibold text-slate-900">{report.reported_weight_kg === null ? tr(locale, "n/a", "לא זמין") : formatNumber(report.reported_weight_kg, locale, 2)}</span>{report.reported_weight_kg === null ? "" : ` ${formatMeasurementUnit("kg", locale)}`}</p>
                    <p>{tr(locale, "Calories", "קלוריות")}: <span className="font-semibold text-slate-900">{formatNumber(report.calories_kcal, locale, 0)}</span> {tr(locale, "kcal", 'קק"ל')}</p>
                    <p>{tr(locale, "Protein", "חלבון")}: <span className="font-semibold text-slate-900">{formatNumber(report.protein_g, locale, 1)}</span> {formatMeasurementUnit("g", locale)}</p>
                    <p>{tr(locale, "Water", "מים")}: <span className="font-semibold text-slate-900">{formatNumber(report.water_ml, locale, 0)}</span> {formatMeasurementUnit("ml", locale)}</p>
                    <p>{tr(locale, "Exercise", "פעילות")}: <span className="font-semibold text-slate-900">{formatNumber(report.exercise_minutes, locale, 0)}</span> {formatMeasurementUnit("min", locale)}</p>
                    <p>{tr(locale, "Magnesium", "מגנזיום")}: <span className="font-semibold text-slate-900">{formatNumber(report.magnesium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Potassium", "אשלגן")}: <span className="font-semibold text-slate-900">{formatNumber(report.potassium_mg, locale, 1)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Iron", "ברזל")}: <span className="font-semibold text-slate-900">{formatNumber(report.iron_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                    <p>{tr(locale, "Zinc", "אבץ")}: <span className="font-semibold text-slate-900">{formatNumber(report.zinc_mg, locale, 2)}</span> {formatMeasurementUnit("mg", locale)}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {aiAvailable && report.raw_report_text?.trim() ? (
                      <form action={retryDailyReportWithAiAction}>
                        <input type="hidden" name="report_id" value={report.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        >
                          {tr(locale, "Retry with AI", "ניסיון חוזר עם AI")}
                        </button>
                      </form>
                    ) : null}

                    {report.requires_confirmation ? (
                      <form action={confirmDailyReportAction}>
                        <input type="hidden" name="report_id" value={report.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                        >
                          {tr(locale, "Confirm and include in progress", "אישור ושילוב בהתקדמות")}
                        </button>
                      </form>
                    ) : null}

                    <details className="rounded-lg border border-cyan-200 bg-cyan-50/40 px-2 py-1">
                      <summary className="cursor-pointer list-none rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50">
                        {tr(locale, "Add to defaults", "הוספה לברירות מחדל")}
                      </summary>
                      <form action={addReportToDefaultsAction} className="mt-2 flex flex-wrap items-center gap-2 px-1 pb-1">
                        <input type="hidden" name="report_id" value={report.id} />
                        <input
                          type="text"
                          name="default_name"
                          maxLength={80}
                          placeholder={tr(locale, "e.g. My morning eggs breakfast", "לדוגמה: ארוחת בוקר ביצים שלי")}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                        />
                        <button
                          type="submit"
                          className="rounded-lg border border-cyan-300 px-3 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
                        >
                          {tr(locale, "Save as default", "שמירה כברירת מחדל")}
                        </button>
                      </form>
                    </details>

                    <form action={deleteDailyReportAction}>
                      <input type="hidden" name="report_id" value={report.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        {tr(locale, "Delete entry", "מחיקת רשומה")}
                      </button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
