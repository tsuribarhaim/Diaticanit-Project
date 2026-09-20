"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseDailyReportWithAi } from "@/lib/ai/daily-report";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { parseDailyReportText, type DailyReportMetrics } from "@/lib/daily-report";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type SavedListIngredient = { name: string; kind: string; quantity: number; unit: string };

function buildDefaultsRedirectPath(params: { error?: string }): string {
  const search = new URLSearchParams();
  if (params.error) {
    search.set("error", params.error);
  }
  const query = search.toString();
  return query ? `/app/daily-report/defaults?${query}` : "/app/daily-report/defaults";
}

function toNumber(value: FormDataEntryValue | null, fallback = 0): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The add/edit form renders one repeatable "ingredient row" (name, kind,
 * quantity, unit) per real ingredient, all sharing the same field names -
 * formData.getAll() naturally collects them as parallel arrays in DOM
 * order, so no indexed field names are needed. Rows left blank (no name
 * typed) are dropped.
 */
function extractIngredientsFromFormData(formData: FormData): SavedListIngredient[] {
  const names = formData.getAll("ingredient_name").map((value) => value.toString().trim());
  const kinds = formData.getAll("ingredient_kind").map((value) => value.toString().trim());
  const quantities = formData.getAll("ingredient_quantity");
  const units = formData.getAll("ingredient_unit").map((value) => value.toString().trim());

  const ingredients: SavedListIngredient[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    ingredients.push({
      name,
      kind: kinds[i] || "food",
      quantity: Math.max(0, toNumber(quantities[i] ?? null, 1)),
      unit: units[i] || "unit",
    });
  }
  return ingredients;
}

/**
 * A saved list item is either a single thing (1 ingredient row - the common
 * case, e.g. "Eggs") or a bundle of several under one name (e.g. "My
 * Breakfast" = eggs + salad + toast + yogurt). For a single ingredient, the
 * bundle's own name/kind/quantity/unit default directly to that
 * ingredient's, so nothing extra needs to be typed - exactly today's
 * behavior. For multiple ingredients there's no single obvious
 * name/quantity/unit, so an explicit bundle name is required and the
 * quantity becomes "how many servings of the whole bundle" (1 serving by
 * default) rather than any one ingredient's own unit.
 */
function resolveBundleFields(
  explicitName: string,
  ingredients: SavedListIngredient[],
  locale: AppLocale,
): { name: string; kind: string; defaultQuantity: number; defaultUnit: string } | { error: string } {
  if (ingredients.length === 0) {
    return { error: tr(locale, "Add at least one ingredient.", "יש להוסיף לפחות מרכיב אחד.") };
  }

  if (ingredients.length === 1) {
    const only = ingredients[0];
    return {
      name: explicitName || only.name,
      kind: only.kind,
      defaultQuantity: only.quantity,
      defaultUnit: only.unit,
    };
  }

  if (!explicitName) {
    return {
      error: tr(
        locale,
        "Please name this saved item (e.g. \"My Breakfast\") since it bundles more than one ingredient.",
        "יש לתת שם לפריט השמור הזה (למשל \"ארוחת הבוקר שלי\") מכיוון שהוא מאגד יותר ממרכיב אחד.",
      ),
    };
  }

  const uniqueKinds = new Set(ingredients.map((item) => item.kind));
  return {
    name: explicitName,
    kind: uniqueKinds.size === 1 ? ingredients[0].kind : "custom",
    defaultQuantity: 1,
    defaultUnit: "serving",
  };
}

function buildDefaultParseText(ingredients: SavedListIngredient[]): string {
  return ingredients
    .map(({ name, kind, quantity, unit }) => {
      if (kind === "exercise") return `${name} ${quantity} minutes`;
      if (kind === "hydration") return `${name} ${quantity} ${unit} water`;
      return `${name} ${quantity} ${unit}`;
    })
    .join(", ");
}

type DefaultItemParseSnapshot = {
  parseMode: "heuristic" | "ai";
  parserVersion: string;
  parseConfidence: number;
  metrics: DailyReportMetrics;
};

async function parseDefaultItemSnapshot({
  userId,
  bundleName,
  ingredients,
  weightKg,
}: {
  userId: string;
  bundleName: string;
  ingredients: SavedListIngredient[];
  weightKg: number;
}): Promise<DefaultItemParseSnapshot> {
  const reportText = buildDefaultParseText(ingredients);
  const aiConfig = getAiExtractionConfig();

  if (aiConfig) {
    try {
      const aiParsed = await parseDailyReportWithAi({
        config: aiConfig,
        reportText,
        weightKg,
      });

      return {
        parseMode: "ai",
        parserVersion: `daily-ai-${aiConfig.provider}-v1`,
        parseConfidence: round(aiParsed.confidence, 4),
        metrics: aiParsed.metrics,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse default item with AI.";
      logServerError("dailyReport.defaults.parse", "ai_parse_failed", {
        userId,
        defaultName: bundleName,
        error: message,
      });
    }
  }

  const heuristicParsed = parseDailyReportText({
    reportText,
    weightKg,
  });

  return {
    parseMode: "heuristic",
    parserVersion: "daily-heuristic-v1",
    parseConfidence: round(heuristicParsed.confidence, 4),
    metrics: heuristicParsed.metrics,
  };
}

export async function addDefaultItemAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const { data: profile } = await supabase
    .from("user_profile")
    .select("weight_kg, preferred_language")
    .eq("user_id", user.id)
    .maybeSingle();
  const locale = normalizeLocale(profile?.preferred_language);

  const explicitName = formData.get("name")?.toString().trim() ?? "";
  const ingredients = extractIngredientsFromFormData(formData);
  const resolved = resolveBundleFields(explicitName, ingredients, locale);

  if ("error" in resolved) {
    redirect(buildDefaultsRedirectPath({ error: resolved.error }));
  }
  const { name, kind, defaultQuantity, defaultUnit } = resolved;

  const { data: existingNameMatch } = await supabase
    .from("user_default_items")
    .select("id")
    .eq("user_id", user.id)
    .ilike("name", name)
    .maybeSingle();

  if (existingNameMatch) {
    redirect(
      buildDefaultsRedirectPath({
        error: tr(
          locale,
          `An item named "${name}" is already in your saved list. Please choose a different name.`,
          `פריט בשם "${name}" כבר קיים ברשימה השמורה שלך. יש לבחור שם אחר.`,
        ),
      }),
    );
  }

  const parsedSnapshot = await parseDefaultItemSnapshot({
    userId: user.id,
    bundleName: name,
    ingredients,
    weightKg: toNumber(profile?.weight_kg, 0),
  });

  await supabase.from("user_default_items").insert({
    user_id: user.id,
    name,
    kind,
    default_quantity: defaultQuantity,
    default_unit: defaultUnit,
    ingredients,
    parse_mode: parsedSnapshot.parseMode,
    parser_version: parsedSnapshot.parserVersion,
    parse_confidence: parsedSnapshot.parseConfidence,
    calories_kcal: round(parsedSnapshot.metrics.caloriesKcal),
    protein_g: round(parsedSnapshot.metrics.proteinG),
    carbs_g: round(parsedSnapshot.metrics.carbsG),
    fat_g: round(parsedSnapshot.metrics.fatG),
    fiber_g: round(parsedSnapshot.metrics.fiberG),
    water_ml: round(parsedSnapshot.metrics.waterMl),
    magnesium_mg: round(parsedSnapshot.metrics.magnesiumMg),
    potassium_mg: round(parsedSnapshot.metrics.potassiumMg),
    iron_mg: round(parsedSnapshot.metrics.ironMg),
    zinc_mg: round(parsedSnapshot.metrics.zincMg),
    sodium_mg: round(parsedSnapshot.metrics.sodiumMg),
    added_sugar_g: round(parsedSnapshot.metrics.addedSugarG),
    calcium_mg: round(parsedSnapshot.metrics.calciumMg),
    vit_c_mg: round(parsedSnapshot.metrics.vitCMg),
    vit_b12_mcg: round(parsedSnapshot.metrics.vitB12Mcg),
    vit_d_mcg: round(parsedSnapshot.metrics.vitDMcg),
    sat_fat_g: round(parsedSnapshot.metrics.satFatG),
    omega3_g: round(parsedSnapshot.metrics.omega3G),
    cholesterol_mg: round(parsedSnapshot.metrics.cholesterolMg),
    exercise_minutes: Math.round(parsedSnapshot.metrics.exerciseMinutes),
    estimated_burn_kcal: round(parsedSnapshot.metrics.estimatedBurnKcal),
    is_active: true,
  });

  revalidatePath("/app/daily-report/defaults");
  revalidatePath("/app/daily-report");
}

export async function updateDefaultItemAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const id = formData.get("id")?.toString();
  if (!id) return;

  const { data: profile } = await supabase
    .from("user_profile")
    .select("weight_kg, preferred_language")
    .eq("user_id", user.id)
    .maybeSingle();
  const locale = normalizeLocale(profile?.preferred_language);

  const explicitName = formData.get("name")?.toString().trim() ?? "";
  const ingredients = extractIngredientsFromFormData(formData);
  const resolved = resolveBundleFields(explicitName, ingredients, locale);

  if ("error" in resolved) {
    redirect(buildDefaultsRedirectPath({ error: resolved.error }));
  }
  const { name, kind, defaultQuantity, defaultUnit } = resolved;

  const { data: existingNameMatch } = await supabase
    .from("user_default_items")
    .select("id")
    .eq("user_id", user.id)
    .neq("id", id)
    .ilike("name", name)
    .maybeSingle();

  if (existingNameMatch) {
    redirect(
      buildDefaultsRedirectPath({
        error: tr(
          locale,
          `An item named "${name}" is already in your saved list. Please choose a different name.`,
          `פריט בשם "${name}" כבר קיים ברשימה השמורה שלך. יש לבחור שם אחר.`,
        ),
      }),
    );
  }

  const parsedSnapshot = await parseDefaultItemSnapshot({
    userId: user.id,
    bundleName: name,
    ingredients,
    weightKg: toNumber(profile?.weight_kg, 0),
  });

  await supabase
    .from("user_default_items")
    .update({
      name,
      kind,
      default_quantity: defaultQuantity,
      default_unit: defaultUnit,
      ingredients,
      parse_mode: parsedSnapshot.parseMode,
      parser_version: parsedSnapshot.parserVersion,
      parse_confidence: parsedSnapshot.parseConfidence,
      calories_kcal: round(parsedSnapshot.metrics.caloriesKcal),
      protein_g: round(parsedSnapshot.metrics.proteinG),
      carbs_g: round(parsedSnapshot.metrics.carbsG),
      fat_g: round(parsedSnapshot.metrics.fatG),
      fiber_g: round(parsedSnapshot.metrics.fiberG),
      water_ml: round(parsedSnapshot.metrics.waterMl),
      magnesium_mg: round(parsedSnapshot.metrics.magnesiumMg),
      potassium_mg: round(parsedSnapshot.metrics.potassiumMg),
      iron_mg: round(parsedSnapshot.metrics.ironMg),
      zinc_mg: round(parsedSnapshot.metrics.zincMg),
      sodium_mg: round(parsedSnapshot.metrics.sodiumMg),
      added_sugar_g: round(parsedSnapshot.metrics.addedSugarG),
      calcium_mg: round(parsedSnapshot.metrics.calciumMg),
      vit_c_mg: round(parsedSnapshot.metrics.vitCMg),
      vit_b12_mcg: round(parsedSnapshot.metrics.vitB12Mcg),
      vit_d_mcg: round(parsedSnapshot.metrics.vitDMcg),
      sat_fat_g: round(parsedSnapshot.metrics.satFatG),
      omega3_g: round(parsedSnapshot.metrics.omega3G),
      cholesterol_mg: round(parsedSnapshot.metrics.cholesterolMg),
      exercise_minutes: Math.round(parsedSnapshot.metrics.exerciseMinutes),
      estimated_burn_kcal: round(parsedSnapshot.metrics.estimatedBurnKcal),
      is_active: formData.get("is_active")?.toString() === "on",
    })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/app/daily-report/defaults");
  revalidatePath("/app/daily-report");
}

/**
 * Ticket #5 (Aggregated Tickets): flips is_active on its own, without
 * re-running the full parse/nutrient-recompute updateDefaultItemAction does
 * - the Active toggle is now a standalone icon in the row itself (see
 * saved-item-row-actions.tsx), not something that requires opening the
 * edit form just to check a box.
 */
export async function toggleDefaultItemActiveAction({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const { error } = await supabase.from("user_default_items").update({ is_active: isActive }).eq("id", id).eq("user_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/app/daily-report/defaults");
  revalidatePath("/app/daily-report");
  return {};
}

export async function deleteDefaultItemAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const id = formData.get("id")?.toString();
  if (!id) return;

  await supabase
    .from("user_default_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/app/daily-report/defaults");
  revalidatePath("/app/daily-report");
}
