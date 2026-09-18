import { redirect } from "next/navigation";

import {
  addDefaultItemAction,
  deleteDefaultItemAction,
  updateDefaultItemAction,
  type SavedListIngredient,
} from "@/app/app/daily-report/defaults/actions";
import { IngredientRowsFieldset, type IngredientRowValue } from "@/components/ingredient-rows-fieldset";
import { formatDefaultItemKind, formatDefaultItemName, formatDefaultUnit, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function kindBadgeClass(kind: string): string {
  if (kind === "hydration") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400";
  if (kind === "exercise") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-400";
  if (kind === "custom") return "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400";
}

function parseIngredients(value: unknown): SavedListIngredient[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) return null;
      return {
        name,
        kind: typeof record.kind === "string" ? record.kind : "food",
        quantity: typeof record.quantity === "number" ? record.quantity : Number(record.quantity) || 1,
        unit: typeof record.unit === "string" ? record.unit : "unit",
      };
    })
    .filter((entry): entry is SavedListIngredient => entry !== null);
}

/** A breakdown line for a bundled item, e.g. "2 pieces Eggs, 1 bowl Salad". */
function formatIngredientsSummary(ingredients: SavedListIngredient[], locale: AppLocale): string {
  return ingredients
    .map((item) => `${item.quantity} ${formatDefaultUnit(item.unit, locale)} ${formatDefaultItemName(item.name, locale)}`)
    .join(", ");
}

export default async function DailyReportDefaultsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

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
    .select("id, name, kind, default_quantity, default_unit, ingredients, is_active")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Daily Report Saved List", "רשימה שמורה לדיווח יומי")}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {tr(
              locale,
              "Configure reusable items for one-click reporting - a single thing like water, or a bundle of several ingredients under one name, like \"My Breakfast\".",
              "הגדירו פריטים לשימוש חוזר לדיווח בלחיצה אחת - דבר בודד כמו מים, או צירוף של כמה מרכיבים תחת שם אחד, כמו \"ארוחת הבוקר שלי\".",
            )}
          </p>
        </div>

        {resolvedSearchParams.error ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
            {resolvedSearchParams.error}
          </p>
        ) : null}

        <form action={addDefaultItemAction} className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {tr(locale, "Item name (only needed for a bundle of several ingredients)", "שם הפריט (נדרש רק עבור צירוף של כמה מרכיבים)")}
            </span>
            <input
              name="name"
              placeholder={tr(locale, "e.g. My Breakfast - leave blank for a single ingredient", "לדוגמה: ארוחת הבוקר שלי - ניתן להשאיר ריק עבור מרכיב בודד")}
              className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>

          <IngredientRowsFieldset locale={locale} />

          <div>
            <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
              {tr(
                locale,
                "Tip: for a single thing, just fill one ingredient row and leave the item name blank - it'll use that ingredient's own name.",
                "טיפ: עבור פריט בודד, יש למלא שורת מרכיב אחת ולהשאיר את שם הפריט ריק - ייעשה שימוש בשם המרכיב עצמו.",
              )}
            </p>
            <button type="submit" className="rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30">
              {tr(locale, "Add item to Saved List", "הוספת פריט לרשימה השמורה")}
            </button>
          </div>
        </form>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Your Saved List items", "פריטי הרשימה השמורה שלך")}</h2>

        {!defaults?.length ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
            {tr(locale, "Your saved list is empty. Create an item above.", "הרשימה השמורה שלך ריקה. אפשר ליצור פריט למעלה.")}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {defaults.map((item) => {
              const ingredients = parseIngredients(item.ingredients);
              const isBundle = ingredients.length > 1;
              const editRows: IngredientRowValue[] =
                ingredients.length > 0
                  ? ingredients
                  : [{ name: item.name, kind: item.kind, quantity: Number(item.default_quantity) || 1, unit: item.default_unit }];

              return (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{formatDefaultItemName(item.name, locale)}</span>
                      {isBundle ? (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{formatIngredientsSummary(ingredients, locale)}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${kindBadgeClass(item.kind)}`}>
                        {formatDefaultItemKind(item.kind, locale)}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          item.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                            : "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {item.is_active ? tr(locale, "Active", "פעיל") : tr(locale, "Inactive", "לא פעיל")}
                      </span>
                    </div>
                  </div>

                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-teal-700 dark:text-teal-400">{tr(locale, "Edit", "עריכה")}</summary>
                    <form action={updateDefaultItemAction} className="mt-2 space-y-3">
                      <input type="hidden" name="id" value={item.id} />
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {tr(locale, "Item name (only needed for a bundle of several ingredients)", "שם הפריט (נדרש רק עבור צירוף של כמה מרכיבים)")}
                        </span>
                        <input
                          name="name"
                          defaultValue={isBundle ? formatDefaultItemName(item.name, locale) : ""}
                          placeholder={tr(locale, "e.g. My Breakfast - leave blank for a single ingredient", "לדוגמה: ארוחת הבוקר שלי - ניתן להשאיר ריק עבור מרכיב בודד")}
                          className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                        />
                      </label>

                      <IngredientRowsFieldset locale={locale} initialRows={editRows} />

                      <label className="flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                        <input type="checkbox" name="is_active" defaultChecked={item.is_active} /> {tr(locale, "Active", "פעיל")}
                      </label>

                      <button type="submit" className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-400 dark:hover:bg-teal-950/40">
                        {tr(locale, "Save", "שמירה")}
                      </button>
                    </form>
                  </details>

                  <form action={deleteDefaultItemAction} className="mt-2">
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40">
                      {tr(locale, "Delete", "מחיקה")}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
