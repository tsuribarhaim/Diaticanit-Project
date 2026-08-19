import Link from "next/link";
import { redirect } from "next/navigation";

import {
  addDefaultItemAction,
  deleteDefaultItemAction,
  updateDefaultItemAction,
} from "@/app/app/daily-report/defaults/actions";
import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function kindBadgeClass(kind: string): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default async function DailyReportDefaultsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = normalizeLocale(
    (
      await supabase
        .from("user_profile")
        .select("preferred_language")
        .eq("user_id", user.id)
        .maybeSingle()
    ).data?.preferred_language,
  );

  const { data: defaults, error } = await supabase
    .from("user_default_items")
    .select(
      "id, name, kind, default_quantity, default_unit, is_active",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Daily report defaults", "ברירות מחדל לדיווח יומי")}</h1>
            <p className="mt-2 text-sm text-slate-600">{tr(locale, "Configure reusable items with name, type, quantity, and unit for one-click reporting.", "הגדירו פריטים לשימוש חוזר עם שם, סוג, כמות ויחידה לדיווח בלחיצה אחת.")}</p>
          </div>
          <Link
            href="/app/daily-report"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to daily report", "חזרה לדיווח היומי")}
          </Link>
        </div>

        <form action={addDefaultItemAction} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">{tr(locale, "Name", "שם")}</span>
            <input name="name" required placeholder={tr(locale, "e.g. boiled eggs", "לדוגמה: ביצים קשות")} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">{tr(locale, "Type", "סוג")}</span>
            <select name="kind" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="food">{formatDefaultItemKind("food", locale)}</option>
              <option value="hydration">{formatDefaultItemKind("hydration", locale)}</option>
              <option value="exercise">{formatDefaultItemKind("exercise", locale)}</option>
              <option value="custom">{formatDefaultItemKind("custom", locale)}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">{tr(locale, "Unit", "יחידה")}</span>
            <select name="default_unit" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="unit">{formatDefaultUnit("unit", locale)}</option>
              <option value="ml">{formatDefaultUnit("ml", locale)}</option>
              <option value="l">{formatDefaultUnit("liters", locale)}</option>
              <option value="g">{formatDefaultUnit("grams", locale)}</option>
              <option value="kg">{formatDefaultUnit("kilograms", locale)}</option>
              <option value="m">{formatDefaultUnit("meters", locale)}</option>
              <option value="km">{formatDefaultUnit("kilometers", locale)}</option>
              <option value="cup">{formatDefaultUnit("cups", locale)}</option>
              <option value="piece">{formatDefaultUnit("pieces", locale)}</option>
              <option value="minutes">{formatDefaultUnit("minutes", locale)}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-700">{tr(locale, "Default quantity", "כמות ברירת מחדל")}</span>
            <input name="default_quantity" type="number" step="0.01" defaultValue={1} placeholder="1" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          </label>

          <div className="sm:col-span-2 lg:col-span-4">
            <p className="mb-2 text-xs text-slate-600">
              {tr(locale, "Tip: Keep names short and specific, like water, walk, or protein shake.", "טיפ: שמרו על שמות קצרים ומדויקים, כמו מים, הליכה או שייק חלבון.")}
            </p>
            <button type="submit" className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
              {tr(locale, "Add default item", "הוספת פריט ברירת מחדל")}
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Your default items", "פריטי ברירת המחדל שלך")}</h2>

        {!defaults?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No defaults yet. Create one above.", "אין עדיין ברירות מחדל. אפשר ליצור אחת למעלה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {defaults.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${kindBadgeClass(item.kind)}`}>
                    {formatDefaultItemKind(item.kind, locale)}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      item.is_active
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 bg-slate-100 text-slate-600"
                    }`}
                  >
                    {item.is_active ? tr(locale, "Active", "פעיל") : tr(locale, "Inactive", "לא פעיל")}
                  </span>
                </div>
                <form action={updateDefaultItemAction} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="id" value={item.id} />
                  <input name="name" defaultValue={formatDefaultItemName(item.name, locale)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select name="kind" defaultValue={item.kind} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="food">{formatDefaultItemKind("food", locale)}</option>
                    <option value="hydration">{formatDefaultItemKind("hydration", locale)}</option>
                    <option value="exercise">{formatDefaultItemKind("exercise", locale)}</option>
                    <option value="custom">{formatDefaultItemKind("custom", locale)}</option>
                  </select>
                  <input name="default_quantity" type="number" step="0.01" defaultValue={item.default_quantity} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <select name="default_unit" defaultValue={item.default_unit} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="unit">{formatDefaultUnit("unit", locale)}</option>
                    <option value="ml">{formatDefaultUnit("ml", locale)}</option>
                    <option value="l">{formatDefaultUnit("liters", locale)}</option>
                    <option value="g">{formatDefaultUnit("grams", locale)}</option>
                    <option value="kg">{formatDefaultUnit("kilograms", locale)}</option>
                    <option value="m">{formatDefaultUnit("meters", locale)}</option>
                    <option value="km">{formatDefaultUnit("kilometers", locale)}</option>
                    <option value="cup">{formatDefaultUnit("cups", locale)}</option>
                    <option value="piece">{formatDefaultUnit("pieces", locale)}</option>
                    <option value="minutes">{formatDefaultUnit("minutes", locale)}</option>
                  </select>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <input type="checkbox" name="is_active" defaultChecked={item.is_active} /> {tr(locale, "Active", "פעיל")}
                  </label>

                  <div className="flex gap-2">
                    <button type="submit" className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50">
                      {tr(locale, "Save", "שמירה")}
                    </button>
                  </div>
                </form>

                <form action={deleteDefaultItemAction} className="mt-2">
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                    {tr(locale, "Delete", "מחיקה")}
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
