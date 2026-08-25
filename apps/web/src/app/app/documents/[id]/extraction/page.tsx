import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  acknowledgeAiExtractionConsentAction,
  generateDemoExtractionAction,
} from "@/app/app/documents/[id]/extraction/actions";
import { getAiExtractionConfig } from "@/lib/ai/env";
import { isPhase2DemoEnabled, isPhase2Enabled } from "@/lib/feature-flags";
import {
  classifyComponentStatus,
  computeOverallStatus,
  generateObservationBullets,
} from "@/lib/extraction-insights";
import { formatExtractionStatus, normalizeLocale, tr } from "@/lib/locale";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: string): string {
  if (status === "green") {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  if (status === "yellow") {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  if (status === "red") {
    return "bg-rose-100 text-rose-800 border-rose-200";
  }
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function describeExtractionRoute(parserVersion: string | null, locale: "en" | "he"): string {
  if (!parserVersion) {
    return tr(locale, "Unknown", "לא ידוע");
  }

  if (parserVersion.startsWith("ai-")) {
    return tr(locale, "AI used", "נעשה שימוש ב-AI");
  }

  if (parserVersion.includes("ai-attempted-empty") && parserVersion.includes("heuristic-fallback-v1")) {
    return tr(locale, "AI attempted (empty result), heuristic fallback used", "בוצע ניסיון AI (תוצאה ריקה), הופעל מנגנון גיבוי יוריסטי");
  }

  if (parserVersion.includes("ai-attempted-error") && parserVersion.includes("heuristic-fallback-v1")) {
    return tr(locale, "AI attempted (error), heuristic fallback used", "בוצע ניסיון AI (שגיאה), הופעל מנגנון גיבוי יוריסטי");
  }

  if (parserVersion.includes("ai-skipped-no-consent")) {
    return tr(locale, "AI skipped (no consent), heuristic parser used", "דולג על AI (ללא הסכמה), הופעל מנוע יוריסטי");
  }

  if (parserVersion.includes("ai-not-configured")) {
    return tr(locale, "AI skipped (not configured), heuristic parser used", "דולג על AI (לא מוגדר), הופעל מנוע יוריסטי");
  }

  if (parserVersion.includes("ai-configured")) {
    return tr(locale, "AI configured, heuristic parser used", "AI מוגדר, הופעל מנוע יוריסטי");
  }

  return tr(locale, "Heuristic parser used", "הופעל מנוע יוריסטי");
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
  const aiExtractionConfig = getAiExtractionConfig();

  const { id } = await params;
  const { reportId: reportIdParam } = await searchParams;

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

  const { data: documentRow } = await supabase
    .from("user_documents")
    .select("id, file_name, extraction_status, extraction_error")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!documentRow) {
    notFound();
  }

  const { data: aiConsentRow } = await supabase
    .from("ai_extraction_consents")
    .select("accepted_at, revoked_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const hasAiExtractionConsent = Boolean(aiConsentRow?.accepted_at) && !aiConsentRow?.revoked_at;

  const reportSelect =
    "id, status, extraction_confidence, parser_version, extracted_at, summary_overall_status, summary_bullets";

  let report: {
    id: string;
    status: string;
    extraction_confidence: number | null;
    parser_version: string | null;
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
    const needsReportSummaryUpdate =
      !hasSummaryBullets ||
      reportData?.summary_overall_status === "unknown" ||
      reportData?.status === "queued" ||
      reportData?.status === "extracted";

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
      const summaryBullets = generateObservationBullets(normalizedComponents);

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
            "id, status, extraction_confidence, parser_version, extracted_at, summary_overall_status, summary_bullets",
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
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Extraction review", "סקירת חילוץ")}</h1>
            <p className="mt-2 text-sm text-slate-600">{documentRow.file_name}</p>
          </div>
          <Link
            href="/app/profile"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            {tr(locale, "Back to profile", "חזרה לפרופיל")}
          </Link>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
          <p>
            <span className="font-semibold text-slate-900">{tr(locale, "Document status", "סטטוס מסמך")}:</span>{" "}
            {documentRow.extraction_status}
          </p>
          {documentRow.extraction_error ? (
            <p className="mt-2 text-rose-700">
              <span className="font-semibold">{tr(locale, "Last error", "שגיאה אחרונה")}:</span>{" "}
              {documentRow.extraction_error}
            </p>
          ) : null}

          {aiExtractionConfig ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="font-semibold text-sky-900">{tr(locale, "AI extraction acknowledgement", "אישור חילוץ AI")}</p>
              <p className="mt-1 text-xs text-sky-800">
                {tr(locale, "Provider", "ספק")}: {aiExtractionConfig.provider}. {tr(locale, "AI extraction sends extracted document text to your configured provider endpoint.", "חילוץ AI שולח את הטקסט שחולץ מהמסמך לנקודת הקצה של הספק שהוגדר.")}
              </p>

              {hasAiExtractionConsent ? (
                <p className="mt-2 text-xs font-medium text-emerald-700">
                  {tr(locale, "Acknowledgement saved. AI extraction is enabled for your account.", "האישור נשמר. חילוץ AI מופעל עבור החשבון שלך.")}
                </p>
              ) : (
                <form action={acknowledgeAiExtractionConsentAction} className="mt-2 space-y-2">
                  <input type="hidden" name="document_id" value={id} />
                  <input
                    type="hidden"
                    name="provider"
                    value={aiExtractionConfig.provider}
                  />
                  <label className="flex items-start gap-2 text-xs text-sky-900">
                    <input
                      type="checkbox"
                      name="accept_ai_extraction"
                      value="yes"
                      required
                      className="mt-0.5"
                    />
                    <span>
                      {tr(locale, "I understand that extraction text may be sent to the configured AI provider for parsing.", "אני מבין/ה שטקסט החילוץ עשוי להישלח לספק ה-AI שהוגדר לצורך עיבוד.")}
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="rounded border border-sky-300 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    {tr(locale, "Save acknowledgement", "שמירת אישור")}
                  </button>
                </form>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        {!reportData ? (
          <p className="text-sm text-slate-600">
            {tr(locale, "No extracted report found yet. Queue extraction from the documents page, then refresh this view.", "עדיין לא נמצא דוח חילוץ. אפשר לתזמן חילוץ מעמוד המסמכים ואז לרענן תצוגה זו.")}
          </p>
        ) : (
          <>
            <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
              <p>
                <span className="font-semibold text-slate-900">{tr(locale, "Report status", "סטטוס דוח")}:</span>{" "}
                {formatExtractionStatus(reportData.status, locale)}
              </p>
              <p>
                <span className="font-semibold text-slate-900">{tr(locale, "Confidence", "רמת ביטחון")}:</span>{" "}
                {reportData.extraction_confidence ?? tr(locale, "n/a", "לא זמין")}
              </p>
              <p>
                <span className="font-semibold text-slate-900">{tr(locale, "Parser version", "גרסת מנוע")}:</span>{" "}
                {reportData.parser_version ?? tr(locale, "n/a", "לא זמין")}
              </p>
            </div>

            <p className="mt-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-900">{tr(locale, "AI route", "מסלול AI")}:</span>{" "}
              {describeExtractionRoute(reportData.parser_version, locale)}
            </p>

            <p className="mt-3 text-xs text-slate-500">
              {tr(locale, "Deterministic insights are applied automatically when extraction components are available.", "תובנות דטרמיניסטיות מיושמות אוטומטית כאשר זמינים רכיבי חילוץ.")}
            </p>

            {!components?.length && isPhase2DemoMode ? (
              <form action={generateDemoExtractionAction} className="mt-3">
                <input type="hidden" name="report_id" value={reportData.id} />
                <input type="hidden" name="document_id" value={id} />
                <button
                  type="submit"
                  className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  {tr(locale, "Generate demo extraction", "יצירת חילוץ הדגמה")}
                </button>
              </form>
            ) : null}

            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-700">
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
                        <tr key={componentId} className="border-t border-slate-200 align-top">
                          <td className="px-3 py-2">{String(component.category ?? "")}</td>
                          <td className="px-3 py-2">{String(component.component_name ?? "")}</td>
                          <td className="px-3 py-2">
                            {component.measured_value ?? component.measured_value_text ?? "n/a"}{" "}
                            {component.unit ?? ""}
                          </td>
                          <td className="px-3 py-2">
                            {component.reference_min ?? "-"} to {component.reference_max ?? "-"}
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
                      <td className="px-3 py-3 text-slate-600" colSpan={5}>
                        {tr(locale, "No extracted components found for this report yet.", "עדיין לא נמצאו רכיבי חילוץ עבור דוח זה.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">{tr(locale, "Summary bullets", "נקודות סיכום")}</p>
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
