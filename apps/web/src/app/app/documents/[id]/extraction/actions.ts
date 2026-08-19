"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { confirmComponentSchema } from "@/lib/extraction";
import {
  classifyComponentStatus,
  computeOverallStatus,
  generateObservationBullets,
} from "@/lib/extraction-insights";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

type DemoComponentSeed = {
  category: string;
  component_name: string;
  measured_value: number;
  unit: string;
  reference_min: number;
  reference_max: number;
  confidence: number;
};

const demoComponentSeeds: DemoComponentSeed[] = [
  {
    category: "CBC",
    component_name: "Hemoglobin",
    measured_value: 12.8,
    unit: "g/dL",
    reference_min: 12.0,
    reference_max: 15.5,
    confidence: 0.93,
  },
  {
    category: "CBC",
    component_name: "WBC",
    measured_value: 11.2,
    unit: "x10^3/uL",
    reference_min: 4.0,
    reference_max: 10.5,
    confidence: 0.9,
  },
  {
    category: "Metabolic",
    component_name: "Glucose (fasting)",
    measured_value: 108,
    unit: "mg/dL",
    reference_min: 70,
    reference_max: 99,
    confidence: 0.89,
  },
  {
    category: "Lipid",
    component_name: "LDL Cholesterol",
    measured_value: 142,
    unit: "mg/dL",
    reference_min: 0,
    reference_max: 99,
    confidence: 0.92,
  },
];

export async function generateDemoExtractionAction(formData: FormData): Promise<void> {
  const reportId = formData.get("report_id")?.toString();
  const documentId = formData.get("document_id")?.toString();
  if (!reportId || !documentId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: existingComponents, error: existingComponentsError } = await supabase
    .from("extracted_components")
    .select("id")
    .eq("report_id", reportId)
    .eq("user_id", user.id)
    .limit(1);

  if (existingComponentsError) {
    logServerError("extraction.generateDemo", "load_components_failed", {
      userId: user.id,
      reportId,
      documentId,
      error: existingComponentsError.message,
    });
    return;
  }

  if (!existingComponents?.length) {
    const { error: insertComponentsError } = await supabase
      .from("extracted_components")
      .insert(
        demoComponentSeeds.map((seed) => ({
          report_id: reportId,
          user_id: user.id,
          category: seed.category,
          component_name: seed.component_name,
          measured_value: seed.measured_value,
          unit: seed.unit,
          reference_min: seed.reference_min,
          reference_max: seed.reference_max,
          status: "unknown",
          confidence: seed.confidence,
          source_line: "demo-seed",
        })),
      );

    if (insertComponentsError) {
      logServerError("extraction.generateDemo", "insert_components_failed", {
        userId: user.id,
        reportId,
        documentId,
        error: insertComponentsError.message,
      });
      return;
    }
  }

  const now = new Date().toISOString();
  const { error: reportUpdateError } = await supabase
    .from("extracted_reports")
    .update({
      status: "extracted",
      extraction_confidence: 0.91,
      parser_version: "demo-seed-v1",
      extracted_at: now,
      source_file_name: "demo-seeded",
    })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (reportUpdateError) {
    logServerError("extraction.generateDemo", "update_report_failed", {
      userId: user.id,
      reportId,
      documentId,
      error: reportUpdateError.message,
    });
    return;
  }

  const { error: documentUpdateError } = await supabase
    .from("user_documents")
    .update({
      extraction_status: "extracted",
      extraction_error: null,
      extraction_last_run_at: now,
    })
    .eq("id", documentId)
    .eq("user_id", user.id);

  if (documentUpdateError) {
    logServerError("extraction.generateDemo", "update_document_failed", {
      userId: user.id,
      reportId,
      documentId,
      error: documentUpdateError.message,
    });
    return;
  }

  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${documentId}/extraction`);
}

export async function acknowledgeAiExtractionConsentAction(formData: FormData): Promise<void> {
  const documentId = formData.get("document_id")?.toString();
  const accepted = formData.get("accept_ai_extraction")?.toString() === "yes";
  if (!documentId || !accepted) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const provider = formData.get("provider")?.toString() || "openai-compatible";

  const { error } = await supabase.from("ai_extraction_consents").upsert(
    {
      user_id: user.id,
      provider,
      accepted_at: new Date().toISOString(),
      revoked_at: null,
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    logServerError("extraction.aiConsent", "upsert_failed", {
      userId: user.id,
      documentId,
      error: error.message,
    });
    return;
  }

  revalidatePath("/app/documents");
  revalidatePath(`/app/documents/${documentId}/extraction`);
}

export async function applyDeterministicInsightsAction(formData: FormData): Promise<void> {
  const reportId = formData.get("report_id")?.toString();
  if (!reportId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const { data: components, error: componentsError } = await supabase
    .from("extracted_components")
    .select("id, user_id, component_name, measured_value, measured_value_text, reference_min, reference_max")
    .eq("report_id", reportId)
    .eq("user_id", user.id);

  if (componentsError || !components) {
    logServerError("extraction.applyInsights", "load_components_failed", {
      userId: user.id,
      reportId,
      error: componentsError?.message,
    });
    return;
  }

  for (const component of components) {
    const status = classifyComponentStatus({
      measuredValue: component.measured_value,
      referenceMin: component.reference_min,
      referenceMax: component.reference_max,
    });

    const { error } = await supabase
      .from("extracted_components")
      .update({ status })
      .eq("id", component.id)
      .eq("user_id", user.id);

    if (error) {
      logServerError("extraction.applyInsights", "update_component_status_failed", {
        userId: user.id,
        reportId,
        componentId: component.id,
        error: error.message,
      });
    }
  }

  const { data: updatedComponents } = await supabase
    .from("extracted_components")
    .select("component_name, measured_value, measured_value_text, reference_min, reference_max, status")
    .eq("report_id", reportId)
    .eq("user_id", user.id);

  const statuses = (updatedComponents ?? []).map((item) => {
    const value = item.status;
    return value === "red" || value === "yellow" || value === "green" ? value : "unknown";
  });

  const summaryOverallStatus = computeOverallStatus(statuses);
  const summaryBullets = generateObservationBullets(updatedComponents ?? []);

  const { error: reportUpdateError } = await supabase
    .from("extracted_reports")
    .update({
      summary_overall_status: summaryOverallStatus,
      summary_bullets: summaryBullets,
      status: "needs_review",
      extracted_at: new Date().toISOString(),
    })
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (reportUpdateError) {
    logServerError("extraction.applyInsights", "update_report_summary_failed", {
      userId: user.id,
      reportId,
      error: reportUpdateError.message,
    });
  }

  revalidatePath("/app/documents");
  const documentId = formData.get("document_id")?.toString();
  if (documentId) {
    revalidatePath(`/app/documents/${documentId}/extraction`);
  }
}

export async function confirmExtractedComponentAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const parsed = confirmComponentSchema.safeParse({
    reportId: formData.get("report_id"),
    componentId: formData.get("component_id"),
    confirmedValueNumeric:
      formData.get("confirmed_value_numeric")?.toString().trim() === ""
        ? undefined
        : Number(formData.get("confirmed_value_numeric")),
    confirmedValueText: formData.get("confirmed_value_text")?.toString(),
    unit: formData.get("unit")?.toString(),
    confirmedStatus: formData.get("confirmed_status"),
    note: formData.get("note")?.toString(),
  });

  if (!parsed.success) {
    logServerError("extraction.confirmComponent", "validation_failed", {
      userId: user.id,
      issues: parsed.error.issues,
    });
    return;
  }

  const { error } = await supabase.from("user_confirmed_components").upsert(
    {
      user_id: user.id,
      report_id: parsed.data.reportId,
      component_id: parsed.data.componentId,
      confirmed_value_numeric: parsed.data.confirmedValueNumeric ?? null,
      confirmed_value_text: parsed.data.confirmedValueText ?? null,
      unit: parsed.data.unit ?? null,
      confirmed_status: parsed.data.confirmedStatus,
      note: parsed.data.note ?? null,
      confirmed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,component_id" },
  );

  if (error) {
    logServerError("extraction.confirmComponent", "upsert_failed", {
      userId: user.id,
      reportId: parsed.data.reportId,
      componentId: parsed.data.componentId,
      error: error.message,
    });
    return;
  }

  const documentId = formData.get("document_id")?.toString();
  if (documentId) {
    revalidatePath(`/app/documents/${documentId}/extraction`);
  }
}
