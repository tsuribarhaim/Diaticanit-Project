import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { generateDemoExtractionAction } from "@/app/app/documents/[id]/extraction/actions";
import { runDocumentExtraction } from "@/app/app/documents/actions";
import { isPhase2DemoEnabled, isPhase2Enabled } from "@/lib/feature-flags";
import {
  classifyComponentStatus,
  computeOverallStatus,
  generateObservationBullets,
} from "@/lib/extraction-insights";
import { formatExtractionStatus, normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: string): string {
  if (status === "green") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800";
  }
  if (status === "yellow") {
    return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800";
  }
  if (status === "red") {
    return "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800";
  }
  return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-800";
}

export default async function DocumentExtractionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reportId?: string }>;
}) {
  if (!isPhase2Enabled()) {
    notFound();
  }

  const isPhase2DemoMode = isPhase2DemoEnabled();

  const { id } = await params;
  const { reportId: reportIdParam } = await searchParams;

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

  const { data: initialDocumentRow } = await supabase
    .from("user_documents")
    .select("id, file_name, extraction_status, extraction_error")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!initialDocumentRow) {
    notFound();
  }

  // Older documents uploaded before extraction ran automatically on upload
  // are still sitting at "not_started" - rather than showing an empty
  // "nothing here yet" state, run extraction the first time anyone asks to
  // view them, so the result is computed once and then reused on every
  // future view instead of staying permanently un-extracted.
  let documentRow = initialDocumentRow;
  if (documentRow.extraction_status === "not_started") {
    await runDocumentExtraction({
      supabase,
      userId: user.id,
      documentId: id,
      extractionMode: "auto",
    });

    const { data: refreshedDocumentRow } = await supabase
      .from("user_documents")
      .select("id, file_name, extraction_status, extraction_error")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (refreshedDocumentRow) {
      documentRow = refreshedDocumentRow;
    }
  }

  const reportSelect =
    "id, status, extraction_confidence, extracted_at, summary_overall_status, summary_bullets";

  let report: {
    id: string;
    status: string;
    extraction_confidence: number | null;
    extracted_at: string | null;
    summary_overall_status: string;
    summary_bullets: string[];
  } | null = null;

  if (reportIdParam) {
    const { data: requestedReport } = await supabase
      .from("extracted_reports")
      .select(reportSelect)
      .eq("id", reportIdParam)
      .eq("document_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    report = requestedReport;
  }

  if (!report) {
    const { data: latestReport } = await supabase
      .from("extracted_reports")
      .select(reportSelect)
      .eq("document_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    report = latestReport;
  }

  let reportData = report;
  const reportId = reportData?.id;
  let { data: components } = reportId
    ? await supabase
        .from("extracted_components")
        .select(
          "id, category, component_name, measured_value, measured_value_text, unit, reference_min, reference_max, status, confidence",
        )
        .eq("report_id", reportId)
        .eq("user_id", user.id)
        .order("category", { ascending: true })
        .order("component_name", { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  if (reportId && components?.length) {
    const needsComponentStatusUpdate = components.some((component) => {
      const status = String(component.status ?? "unknown");
      return !(status === "red" || status === "yellow" || status === "green");
    });

    const hasSummaryBullets =
      Array.isArray(reportData?.summary_bullets) && reportData.summary_bullets.length > 0;
    // Regenerate on every view (not just the first) until the user actually
    // confirms the report - otherwise the summary sentences get baked in
    // English (or whichever locale was active the first time anyone viewed
    // this report) and never catch up to a later locale switch.
    const needsReportSummaryUpdate =
      !hasSummaryBullets ||
      reportData?.summary_overall_status === "unknown" ||
      reportData?.status !== "confirmed";

    if (needsComponentStatusUpdate || needsReportSummaryUpdate) {
      await Promise.all(components.map(async (component) => {
        const status = classifyComponentStatus({
          measuredValue: component.measured_value,
          referenceMin: component.reference_min,
          referenceMax: component.reference_max,
        });

        const { error: componentUpdateError } = await supabase
          .from("extracted_components")
          .update({ status })
          .eq("id", String(component.id))
          .eq("user_id", user.id);

        if (componentUpdateError) {
          logServerError("extraction.view.autoApply", "update_component_status_failed", {
            userId: user.id,
            reportId,
            componentId: String(component.id),
            error: componentUpdateError.message,
          });
        }
      }));

      const { data: refreshedComponents, error: refreshedComponentsError } = await supabase
        .from("extracted_components")
        .select(
          "id, category, component_name, measured_value, measured_value_text, unit, reference_min, reference_max, status, confidence",
        )
        .eq("report_id", reportId)
        .eq("user_id", user.id)
        .order("category", { ascending: true })
        .order("component_name", { ascending: true });

      if (refreshedComponentsError) {
        logServerError("extraction.view.autoApply", "reload_components_failed", {
          userId: user.id,
          reportId,
          error: refreshedComponentsError.message,
        });
      } else if (refreshedComponents) {
        components = refreshedComponents;
      }

      const statuses = (components ?? []).map((item) => {
        const value = item.status;
        return value === "red" || value === "yellow" || value === "green"
          ? value
          : "unknown";
      });

      const normalizedComponents = (components ?? []).map((item) => ({
        component_name: String(item.component_name ?? ""),
        measured_value:
          typeof item.measured_value === "number" ? item.measured_value : null,
        measured_value_text:
          typeof item.measured_value_text === "string"
            ? item.measured_value_text
            : null,
        reference_min: typeof item.reference_min === "number" ? item.reference_min : null,
        reference_max: typeof item.reference_max === "number" ? item.reference_max : null,
        status: typeof item.status === "string" ? item.status : null,
      }));

      const summaryOverallStatus = computeOverallStatus(statuses);
      const summaryBullets = generateObservationBullets(normalizedComponents, locale);

      const { error: reportUpdateError } = await supabase
        .from("extracted_reports")
        .update({
          summary_overall_status: summaryOverallStatus,
          summary_bullets: summaryBullets,
          status: "needs_review",
          extracted_at: reportData?.extracted_at ?? new Date().toISOString(),
        })
        .eq("id", reportId)
        .eq("user_id", user.id);

      if (reportUpdateError) {
        logServerError("extraction.view.autoApply", "update_report_summary_failed", {
          userId: user.id,
          reportId,
          error: reportUpdateError.message,
        });
      } else {
        const { data: refreshedReport } = await supabase
          .from("extracted_reports")
          .select(
            "id, status, extraction_confidence, extracted_at, summary_overall_status, summary_bullets",
          )
          .eq("id", reportId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (refreshedReport) {
          reportData = refreshedReport;
        }
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "Extraction review", "סקירת חילוץ")}</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{documentRow.file_name}</p>
          </div>
          <Link
            href="/app/profile"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {tr(locale, "Close", "סגירה")}
          </Link>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
          <p>
            <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Document status", "סטטוס מסמך")}:</span>{" "}
            {formatExtractionStatus(documentRow.extraction_status, locale)}
          </p>
          {documentRow.extraction_error ? (
            <p className="mt-2 text-rose-700 dark:text-rose-400">
              <span className="font-semibold">{tr(locale, "Last error", "שגיאה אחרונה")}:</span>{" "}
              {documentRow.extraction_error}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {!reportData ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {tr(
              locale,
              "Extraction didn't produce a report for this document. Check the status above, or try re-uploading the file.",
              "החילוץ לא הפיק דוח עבור מסמך זה. יש לבדוק את הסטטוס למעלה, או לנסות להעלות את הקובץ מחדש.",
            )}
          </p>
        ) : (
          <>
            <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2 dark:text-slate-300">
              <p>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Report status", "סטטוס דוח")}:</span>{" "}
                {formatExtractionStatus(reportData.status, locale)}
              </p>
              <p>
                <span className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Confidence", "רמת ביטחון")}:</span>{" "}
                {reportData.extraction_confidence ?? tr(locale, "n/a", "לא זמין")}
              </p>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              {tr(locale, "Deterministic insights are applied automatically when extraction components are available.", "תובנות דטרמיניסטיות מיושמות אוטומטית כאשר זמינים רכיבי חילוץ.")}
            </p>

            {!components?.length && isPhase2DemoMode ? (
              <form action={generateDemoExtractionAction} className="mt-3">
                <input type="hidden" name="report_id" value={reportData.id} />
                <input type="hidden" name="document_id" value={id} />
                <button
                  type="submit"
                  className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                >
                  {tr(locale, "Generate demo extraction", "יצירת חילוץ הדגמה")}
                </button>
              </form>
            ) : null}

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2">{tr(locale, "Category", "קטגוריה")}</th>
                    <th className="px-3 py-2">{tr(locale, "Component", "רכיב")}</th>
                    <th className="px-3 py-2">{tr(locale, "Value", "ערך")}</th>
                    <th className="px-3 py-2">{tr(locale, "Reference", "טווח ייחוס")}</th>
                    <th className="px-3 py-2">{tr(locale, "Status", "סטטוס")}</th>
                  </tr>
                </thead>
                <tbody>
                  {components && components.length ? (
                    components.map((component) => {
                      const componentId = String(component.id);

                      return (
                        <tr key={componentId} className="border-t border-slate-200 align-top dark:border-slate-800">
                          <td className="px-3 py-2">{String(component.category ?? "")}</td>
                          <td className="px-3 py-2">{String(component.component_name ?? "")}</td>
                          <td className="px-3 py-2">
                            {component.measured_value ?? component.measured_value_text ?? tr(locale, "n/a", "לא זמין")}{" "}
                            {component.unit ?? ""}
                          </td>
                          <td className="px-3 py-2">
                            {component.reference_min ?? "-"}–{component.reference_max ?? "-"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClasses(String(component.status ?? "unknown"))}`}
                            >
                              {formatExtractionStatus(String(component.status ?? "unknown"), locale)}
                            </span>
                            <p className="mt-1 text-xs text-slate-500">
                              {tr(locale, "Confidence", "רמת ביטחון")}: {component.confidence ?? tr(locale, "n/a", "לא זמין")}
                            </p>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400" colSpan={5}>
                        {tr(locale, "No extracted components found for this report yet.", "עדיין לא נמצאו רכיבי חילוץ עבור דוח זה.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Summary bullets", "נקודות סיכום")}</p>
              {reportData.summary_bullets?.length ? (
                <ul className="mt-2 list-disc pl-5">
                  {(reportData.summary_bullets as string[]).map((bullet: string) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">{tr(locale, "No summary bullets available yet.", "עדיין אין נקודות סיכום.")}</p>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
