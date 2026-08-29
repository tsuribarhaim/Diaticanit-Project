"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseDailyReportWithAi } from "@/lib/ai/daily-report";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { parseDailyReportText, type DailyReportMetrics } from "@/lib/daily-report";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

function toNumber(value: FormDataEntryValue | null, fallback = 0): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildDefaultParseText({
  name,
  kind,
  quantity,
  unit,
}: {
  name: string;
  kind: string;
  quantity: number;
  unit: string;
}): string {
  if (kind === "exercise") {
    return `${name} ${quantity} minutes`;
  }

  if (kind === "hydration") {
    return `${name} ${quantity} ${unit} water`;
  }

  return `${name} ${quantity} ${unit}`;
}

type DefaultItemParseSnapshot = {
  parseMode: "heuristic" | "ai";
  parserVersion: string;
  parseConfidence: number;
  metrics: DailyReportMetrics;
};

async function parseDefaultItemSnapshot({
  userId,
  name,
  kind,
  quantity,
  unit,
  weightKg,
}: {
  userId: string;
  name: string;
  kind: string;
  quantity: number;
  unit: string;
  weightKg: number;
}): Promise<DefaultItemParseSnapshot> {
  const reportText = buildDefaultParseText({ name, kind, quantity, unit });
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
        defaultName: name,
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

  const name = formData.get("name")?.toString().trim();
  const kind = formData.get("kind")?.toString() ?? "food";
  if (!name) return;

  const defaultQuantity = Math.max(0, toNumber(formData.get("default_quantity"), 1));
  const defaultUnit = formData.get("default_unit")?.toString().trim() || "unit";

  const { data: profile } = await supabase
    .from("user_profile")
    .select("weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();

  const parsedSnapshot = await parseDefaultItemSnapshot({
    userId: user.id,
    name,
    kind,
    quantity: defaultQuantity,
    unit: defaultUnit,
    weightKg: toNumber(profile?.weight_kg, 0),
  });

  await supabase.from("user_default_items").insert({
    user_id: user.id,
    name,
    kind,
    default_quantity: defaultQuantity,
    default_unit: defaultUnit,
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
  const name = formData.get("name")?.toString().trim();
  const kind = formData.get("kind")?.toString() ?? "food";
  if (!id || !name) return;

  const defaultQuantity = Math.max(0, toNumber(formData.get("default_quantity"), 1));
  const defaultUnit = formData.get("default_unit")?.toString().trim() || "unit";

  const { data: profile } = await supabase
    .from("user_profile")
    .select("weight_kg")
    .eq("user_id", user.id)
    .maybeSingle();

  const parsedSnapshot = await parseDefaultItemSnapshot({
    userId: user.id,
    name,
    kind,
    quantity: defaultQuantity,
    unit: defaultUnit,
    weightKg: toNumber(profile?.weight_kg, 0),
  });

  await supabase
    .from("user_default_items")
    .update({
      name,
      kind,
      default_quantity: defaultQuantity,
      default_unit: defaultUnit,
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
      exercise_minutes: Math.round(parsedSnapshot.metrics.exerciseMinutes),
      estimated_burn_kcal: round(parsedSnapshot.metrics.estimatedBurnKcal),
      is_active: formData.get("is_active")?.toString() === "on",
    })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/app/daily-report/defaults");
  revalidatePath("/app/daily-report");
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
