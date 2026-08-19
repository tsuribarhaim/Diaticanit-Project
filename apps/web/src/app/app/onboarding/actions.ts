"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAiExtractionConfig } from "@/lib/ai/env";
import {
  onboardingProfileSchema,
  parseDelimitedList,
} from "@/lib/profile";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export type OnboardingActionState = {
  error?: string;
};

const LOCALE_COOKIE = "phc_locale";

function isMissingPreferredLanguageColumn(errorMessage: string): boolean {
  return errorMessage.includes("preferred_language") && errorMessage.includes("schema cache");
}

export async function saveOnboardingProfileAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsed = onboardingProfileSchema.safeParse({
    age: formData.get("age"),
    gender: formData.get("gender"),
    height_cm: formData.get("height_cm"),
    weight_kg: formData.get("weight_kg"),
    activity_level: formData.get("activity_level"),
    preferred_language: formData.get("preferred_language"),
    allergies: parseDelimitedList(formData.get("allergies")),
    medical_conditions: parseDelimitedList(formData.get("medical_conditions")),
  });

  if (!parsed.success) {
    logServerError("onboarding.saveProfile", "validation_failed", {
      userId: user.id,
      issues: parsed.error.issues,
    });
    return { error: parsed.error.issues[0]?.message ?? "Invalid form payload." };
  }

  const payload = {
    user_id: user.id,
    ...parsed.data,
  };

  const acceptedAiExtraction = formData.get("accept_ai_extraction")?.toString() === "yes";

  const { error } = await supabase
    .from("user_profile")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    logServerError("onboarding.saveProfile", "upsert_failed", {
      userId: user.id,
      error: error.message,
    });

    if (isMissingPreferredLanguageColumn(error.message)) {
      return {
        error:
          "Database migration missing: apply db/migrations/010_phase4_profile_preferred_language.sql, then try again.",
      };
    }

    return { error: error.message };
  }

  if (acceptedAiExtraction) {
    const aiConfig = getAiExtractionConfig();
    const provider = aiConfig?.provider ?? "openai-compatible";

    const { error: aiConsentError } = await supabase
      .from("ai_extraction_consents")
      .upsert(
        {
          user_id: user.id,
          provider,
          accepted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "user_id" },
      );

    if (aiConsentError) {
      logServerError("onboarding.saveProfile", "ai_consent_upsert_failed", {
        userId: user.id,
        error: aiConsentError.message,
      });
    }
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, parsed.data.preferred_language, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/app");
}
