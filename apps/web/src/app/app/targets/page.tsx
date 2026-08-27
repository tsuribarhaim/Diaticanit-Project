import Link from "next/link";
import { redirect } from "next/navigation";

import { generateTargetsPayload, hasAiTargetsConsent } from "@/app/app/targets/actions";
import { TargetProfileView } from "@/components/target-profile-view";
import { TargetsGenerateForm } from "@/components/targets-generate-form";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { formatDateTimeForLocale, normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";
import { estimateMaintenanceCalories, mapTargetProfileRowToPayload, type ProfileForTargets } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("user_profile")
    .select(
      "age, gender, biological_sex, height_cm, weight_kg, activity_level, allergies, medical_conditions, medical_conditions_details, regular_medications_details, dietary_preference, exercise_modalities, exercise_schedule_by_modality, habits, pregnancy_lactation_status, hot_climate_or_heavy_sweating, preferred_language",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profileRow) {
    redirect("/app/onboarding");
  }

  const locale = normalizeLocale(profileRow.preferred_language);

  const profile: ProfileForTargets = {
    age: Number(profileRow.age ?? 0),
    gender: profileRow.gender ?? null,
    biological_sex: profileRow.biological_sex ?? null,
    height_cm: Number(profileRow.height_cm ?? 0),
    weight_kg: Number(profileRow.weight_kg ?? 0),
    activity_level: (profileRow.activity_level as ProfileForTargets["activity_level"]) ?? "sedentary",
    allergies: Array.isArray(profileRow.allergies) ? profileRow.allergies : [],
    medical_conditions: Array.isArray(profileRow.medical_conditions) ? profileRow.medical_conditions : [],
    medical_conditions_details: profileRow.medical_conditions_details ?? null,
    regular_medications_details: profileRow.regular_medications_details ?? null,
    dietary_preference: profileRow.dietary_preference ?? null,
    exercise_modalities: Array.isArray(profileRow.exercise_modalities) ? profileRow.exercise_modalities : [],
    exercise_schedule_by_modality:
      (profileRow.exercise_schedule_by_modality as ProfileForTargets["exercise_schedule_by_modality"]) ?? null,
    habits: Array.isArray(profileRow.habits) ? profileRow.habits : [],
    pregnancy_lactation_status: profileRow.pregnancy_lactation_status ?? null,
    hot_climate_or_heavy_sweating: Boolean(profileRow.hot_climate_or_heavy_sweating),
  };

  const maintenanceCalories = estimateMaintenanceCalories(profile);

  const { data: activeTargetProfile, error: targetProfileError } = await supabase
    .from("user_target_profiles")
    .select(
      "id, raw_goal_text, goal_type, target_weight_kg, duration_days, blood_balance_focus, sleep_focus, calories_min, calories_max, protein_min_g, protein_max_g, carbs_min_g, carbs_max_g, fats_min_g, fats_max_g, fiber_min_g, fiber_max_g, sodium_min_mg, sodium_max_mg, added_sugar_min_g, added_sugar_max_g, water_min_ml, water_max_ml, potassium_min_mg, potassium_max_mg, magnesium_min_mg, magnesium_max_mg, calcium_min_mg, calcium_max_mg, iron_min_mg, iron_max_mg, zinc_min_mg, zinc_max_mg, vit_c_min_mg, vit_c_max_mg, vit_b12_min_mcg, vit_b12_max_mcg, vit_d_min_mcg, vit_d_max_mcg, sat_fat_min_g, sat_fat_max_g, omega3_min_g, omega3_max_g, exercise_targets, habits_do, habits_dont, ai_rationale_explanation, translation_confidence, analysis_source, sys_start_date",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (targetProfileError) {
    throw new Error(targetProfileError.message);
  }

  let initialPreview: { goalText: string; source: "ai" | "heuristic"; payload: ReturnType<typeof mapTargetProfileRowToPayload> } | null = null;
  let initialWarning: string | undefined;

  if (!activeTargetProfile) {
    const aiConfig = getAiExtractionConfig();
    const hasConsent = aiConfig ? await hasAiTargetsConsent({ supabase, userId: user.id }) : false;
    const { payload, source, heuristicReason } = await generateTargetsPayload({
      goalText: "",
      profile,
      locale,
      aiConfig,
      hasConsent,
    });
    initialPreview = { goalText: "", source, payload };
    initialWarning = source === "heuristic" ? heuristicReason ?? undefined : undefined;
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Targets", "יעדים")}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {tr(
                locale,
                "Your personalized daily nutrition, exercise, and habit targets.",
                "יעדי התזונה, הפעילות וההרגלים היומיים המותאמים אישית שלך.",
              )}
            </p>
          </div>

          <Link
            href="/app"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to dashboard", "חזרה ללוח הבקרה")}
          </Link>
        </div>

        {!activeTargetProfile ? (
          <>
            <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
              {tr(
                locale,
                "Here's a recommended baseline based on your profile. Optionally describe a specific goal below and regenerate to refine it, then approve to lock it in.",
                "להלן תכנית בסיס מומלצת בהתאם לפרופיל שלך. ניתן לתאר מטרה ספציפית למטה וליצור מחדש כדי לחדד אותה, ולאחר מכן לאשר וננעל אותה.",
              )}
            </p>
            <TargetsGenerateForm
              locale={locale}
              maintenanceCalories={maintenanceCalories}
              initialPreview={initialPreview ?? undefined}
              initialWarning={initialWarning}
            />
          </>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-slate-900">{tr(locale, "Original request", "בקשה מקורית")}:</span>{" "}
                <span className="italic text-slate-600">{activeTargetProfile.raw_goal_text}</span>
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Locked at", "ננעל בתאריך")}:</span>{" "}
                {formatDateTimeForLocale(activeTargetProfile.sys_start_date, locale)}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-slate-900">{tr(locale, "Analysis source", "מקור ניתוח")}:</span>{" "}
                {activeTargetProfile.analysis_source === "ai" ? "AI" : tr(locale, "Heuristic", "יוריסטי")}
              </p>
            </div>

            <TargetProfileView
              payload={mapTargetProfileRowToPayload(activeTargetProfile)}
              locale={locale}
              maintenanceCalories={maintenanceCalories}
            />

            <p className="text-xs text-slate-500">
              {tr(
                locale,
                "Informational support only. Check with a qualified healthcare professional for medical decisions.",
                "למטרות מידע בלבד. להחלטות רפואיות יש להתייעץ עם איש מקצוע מוסמך.",
              )}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
