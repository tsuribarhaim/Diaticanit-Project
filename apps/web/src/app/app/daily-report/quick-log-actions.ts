"use server";

import { redirect } from "next/navigation";

import { buildDefaultParseText, parseDailyReportText, type DailyReportMetrics } from "@/lib/daily-report";
import { normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type QuickLogSavedItem = {
  id: string;
  name: string;
  kind: string;
  quantity: number;
  unit: string;
};

export type ListQuickLogSavedItemsResult = { items: QuickLogSavedItem[] } | { error: string };

/**
 * The global chat widget's saved-list popover (Phase E of the chat
 * redesign) - a flat, read-only list of the user's active saved items,
 * for the "tap the icon, tap an item, it's logged" flow. Deliberately a
 * separate, lighter query than the Manage Saved List page's own (which
 * also needs ingredients/is_active for editing) - this only needs enough
 * to render a row and pass an id back to logSavedItemFromChatAction.
 */
export async function listQuickLogSavedItemsAction(): Promise<ListQuickLogSavedItemsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data, error } = await supabase
    .from("user_default_items")
    .select("id, name, kind, default_quantity, default_unit")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    logServerError("dailyReport.listQuickLogSavedItems", "query_failed", { userId: user.id, error: error.message });
    return { error: tr(normalizeLocale(undefined), "Could not load your saved list. Please try again.", "לא ניתן היה לטעון את הרשימה השמורה. יש לנסות שוב.") };
  }

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      quantity: Number(row.default_quantity ?? 1),
      unit: row.default_unit,
    })),
  };
}

export type LogSavedItemFromChatResult = { error?: string; success?: boolean; itemName?: string; quantity?: number; unit?: string };

/**
 * Logs one saved item immediately at its default quantity - no quantity
 * picker, no review step, per the simplified design ("user clicks the
 * item, item is saved and added to his daily log, that's it"). Reuses the
 * exact same cached-metrics-first, text-parse-fallback logic
 * saveDailyReportAction's own selected-defaults merge already uses (see
 * that function's own comment on parse_confidence as the cached-vs-not
 * signal), just for a single standalone entry instead of merging into a
 * larger report - this is intentionally a separate, minimal insert (same
 * scope decision as logDailyReportFromChat in app/app/chat/actions.ts): no
 * merging with anything else already logged today, no custom-target-value
 * reconciliation, no weight-sync-to-profile.
 */
export async function logSavedItemFromChatAction(itemId: string): Promise<LogSavedItemFromChatResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow } = await supabase.from("user_profile").select("preferred_language, weight_kg").eq("user_id", user.id).maybeSingle();
  const locale = normalizeLocale(profileRow?.preferred_language);
  const genericFailureMessage = tr(locale, "Could not log that. Please try again.", "לא ניתן היה לרשום זאת. יש לנסות שוב.");

  const { data: item, error: itemError } = await supabase
    .from("user_default_items")
    .select(
      "id, name, kind, default_quantity, default_unit, parse_confidence, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, magnesium_mg, potassium_mg, iron_mg, zinc_mg, sodium_mg, added_sugar_g, calcium_mg, vit_c_mg, vit_b12_mcg, vit_d_mcg, sat_fat_g, omega3_g, cholesterol_mg, exercise_minutes, estimated_burn_kcal",
    )
    .eq("user_id", user.id)
    .eq("id", itemId)
    .eq("is_active", true)
    .maybeSingle();

  if (itemError || !item) {
    return { error: genericFailureMessage };
  }

  const quantity = Number(item.default_quantity ?? 1);
  const hasCachedMetrics = Number(item.parse_confidence ?? 0) > 0;

  let metrics: DailyReportMetrics;
  let confidence: number;

  if (hasCachedMetrics) {
    metrics = {
      caloriesKcal: Number(item.calories_kcal ?? 0),
      proteinG: Number(item.protein_g ?? 0),
      carbsG: Number(item.carbs_g ?? 0),
      fatG: Number(item.fat_g ?? 0),
      fiberG: Number(item.fiber_g ?? 0),
      waterMl: Number(item.water_ml ?? 0),
      magnesiumMg: Number(item.magnesium_mg ?? 0),
      potassiumMg: Number(item.potassium_mg ?? 0),
      ironMg: Number(item.iron_mg ?? 0),
      zincMg: Number(item.zinc_mg ?? 0),
      sodiumMg: Number(item.sodium_mg ?? 0),
      addedSugarG: Number(item.added_sugar_g ?? 0),
      calciumMg: Number(item.calcium_mg ?? 0),
      vitCMg: Number(item.vit_c_mg ?? 0),
      vitB12Mcg: Number(item.vit_b12_mcg ?? 0),
      vitDMcg: Number(item.vit_d_mcg ?? 0),
      satFatG: Number(item.sat_fat_g ?? 0),
      omega3G: Number(item.omega3_g ?? 0),
      cholesterolMg: Number(item.cholesterol_mg ?? 0),
      exerciseMinutes: Number(item.exercise_minutes ?? 0),
      estimatedBurnKcal: Number(item.estimated_burn_kcal ?? 0),
    };
    confidence = Number(item.parse_confidence ?? 0.8);
  } else {
    const fallbackParsed = parseDailyReportText({
      reportText: buildDefaultParseText({ name: item.name, kind: item.kind, quantity, unit: item.default_unit }),
      weightKg: Number(profileRow?.weight_kg ?? 0),
    });
    metrics = fallbackParsed.metrics;
    confidence = fallbackParsed.confidence;
  }

  const requiresConfirmation = confidence < 0.6;
  const nowIso = new Date().toISOString();

  const { error: insertError } = await supabase.from("user_daily_reports").insert({
    user_id: user.id,
    raw_report_text: tr(locale, `Added from saved list: ${item.name}`, `נוסף מהרשימה השמורה: ${item.name}`),
    report_at: nowIso,
    status: requiresConfirmation ? "needs_confirmation" : "confirmed",
    parse_confidence: confidence,
    requires_confirmation: requiresConfirmation,
    confirmed_at: requiresConfirmation ? null : nowIso,
    calories_kcal: Math.round(metrics.caloriesKcal),
    protein_g: Math.round(metrics.proteinG),
    carbs_g: Math.round(metrics.carbsG),
    fat_g: Math.round(metrics.fatG),
    fiber_g: Math.round(metrics.fiberG),
    water_ml: Math.round(metrics.waterMl),
    magnesium_mg: Math.round(metrics.magnesiumMg),
    potassium_mg: Math.round(metrics.potassiumMg),
    iron_mg: Math.round(metrics.ironMg),
    zinc_mg: Math.round(metrics.zincMg),
    sodium_mg: Math.round(metrics.sodiumMg),
    added_sugar_g: Math.round(metrics.addedSugarG),
    calcium_mg: Math.round(metrics.calciumMg),
    vit_c_mg: Math.round(metrics.vitCMg),
    vit_b12_mcg: Math.round(metrics.vitB12Mcg),
    vit_d_mcg: Math.round(metrics.vitDMcg),
    sat_fat_g: Math.round(metrics.satFatG),
    omega3_g: Math.round(metrics.omega3G),
    cholesterol_mg: Math.round(metrics.cholesterolMg),
    exercise_minutes: Math.round(metrics.exerciseMinutes),
    estimated_burn_kcal: Math.round(metrics.estimatedBurnKcal),
    parsed_items:
      item.kind === "exercise"
        ? []
        : [
            {
              name: item.name,
              quantity,
              unit: item.default_unit,
              caloriesKcal: metrics.caloriesKcal,
              proteinG: metrics.proteinG,
              carbsG: metrics.carbsG,
              fatG: metrics.fatG,
              fiberG: metrics.fiberG,
              waterMl: metrics.waterMl,
              magnesiumMg: metrics.magnesiumMg,
              potassiumMg: metrics.potassiumMg,
              ironMg: metrics.ironMg,
              zincMg: metrics.zincMg,
              sodiumMg: metrics.sodiumMg,
              addedSugarG: metrics.addedSugarG,
              calciumMg: metrics.calciumMg,
              vitCMg: metrics.vitCMg,
              vitB12Mcg: metrics.vitB12Mcg,
              vitDMcg: metrics.vitDMcg,
              satFatG: metrics.satFatG,
              omega3G: metrics.omega3G,
              cholesterolMg: metrics.cholesterolMg,
            },
          ],
    parsed_exercises:
      item.kind === "exercise"
        ? [{ name: item.name, minutes: Math.max(0, metrics.exerciseMinutes || Math.round(quantity)), estimatedBurnKcal: Math.max(0, metrics.estimatedBurnKcal) }]
        : [],
  });

  if (insertError) {
    logServerError("dailyReport.logSavedItemFromChat", "insert_failed", { userId: user.id, error: insertError.message });
    return { error: genericFailureMessage };
  }

  return { success: true, itemName: item.name, quantity, unit: item.default_unit };
}
