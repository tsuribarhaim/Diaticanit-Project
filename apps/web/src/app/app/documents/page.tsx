import Link from "next/link";
import { redirect } from "next/navigation";

import {
  deleteDocumentAction,
  openOriginalDocumentAction,
  requestExtractionAction,
} from "@/app/app/documents/actions";
import { DocumentUploadForm } from "@/components/document-upload-form";
import { formatFileSize } from "@/lib/documents";
import { isPhase2Enabled } from "@/lib/feature-flags";
import { formatDateTimeForLocale, formatExtractionStatus, normalizeLocale, tr } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const phase2Enabled = isPhase2Enabled();
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

  const { data: documents, error } = await supabase
    .from("user_documents")
    .select(
      "id, category, file_name, mime_type, file_size_bytes, created_at, extraction_status",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const { data: reports } = await supabase
    .from("extracted_reports")
    .select("id, document_id, parser_version")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const latestAiReportByDocument = new Map<string, { id: string }>();
  const latestHeuristicReportByDocument = new Map<string, { id: string }>();

  for (const report of reports ?? []) {
    const parserVersion = report.parser_version ?? "";
    const hasAiMode =
      parserVersion.includes("mode-ai-used") ||
      parserVersion.startsWith("ai-") ||
      parserVersion.includes("|ai-") ||
      parserVersion.includes("ai-attempted") ||
      parserVersion.includes("ai-skipped") ||
      parserVersion.includes("ai-configured");
    const hasHeuristicMode =
      parserVersion.includes("mode-heuristic-used") ||
      parserVersion.includes("heuristic") ||
      parserVersion.includes("fallback") ||
      parserVersion.startsWith("pdf-") ||
      parserVersion.startsWith("text-") ||
      parserVersion.startsWith("image-");

    if (hasAiMode && !latestAiReportByDocument.has(report.document_id)) {
      latestAiReportByDocument.set(report.document_id, { id: report.id });
    }

    if (hasHeuristicMode && !latestHeuristicReportByDocument.has(report.document_id)) {
      latestHeuristicReportByDocument.set(report.document_id, { id: report.id });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-slate-900">{tr(locale, "Documents", "מסמכים")}</h1>
        <p className="mt-3 text-sm text-slate-600">{tr(locale, "Upload and manage your private files.", "העלאה וניהול של הקבצים האישיים שלכם.")}</p>

        <div className="mt-5">
          <DocumentUploadForm locale={locale} />
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{tr(locale, "Your files", "הקבצים שלכם")}</h2>
          <div className="flex gap-2">
            <Link
              href="/app"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {tr(locale, "Back to dashboard", "חזרה ללוח הבקרה")}
            </Link>
          </div>
        </div>

        {!documents?.length ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
            {tr(locale, "No documents uploaded yet.", "עדיין לא הועלו מסמכים.")}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {documents.map((doc) => {
              const aiReport = latestAiReportByDocument.get(doc.id);
              const heuristicReport = latestHeuristicReportByDocument.get(doc.id);

              return (
                <li
                key={doc.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{doc.file_name}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {doc.category} • {doc.mime_type ?? tr(locale, "Unknown type", "סוג לא ידוע")} •{" "}
                      {formatFileSize(doc.file_size_bytes)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {tr(locale, "Uploaded", "הועלה")} {formatDateTimeForLocale(doc.created_at, locale)}
                    </p>
                    {phase2Enabled ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {tr(locale, "Extraction status", "סטטוס חילוץ")}: {formatExtractionStatus(doc.extraction_status ?? "not_started", locale)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex gap-2">
                    {phase2Enabled ? (
                      <>
                        {aiReport?.id ? (
                          <Link
                            href={`/app/documents/${doc.id}/extraction?reportId=${aiReport.id}`}
                            className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                          >
                            {tr(locale, "AI view", "תצוגת AI")}
                          </Link>
                        ) : (
                          <form action={requestExtractionAction}>
                            <input type="hidden" name="document_id" value={doc.id} />
                            <input type="hidden" name="extraction_mode" value="ai" />
                            <button
                              type="submit"
                              className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                            >
                              {tr(locale, "AI extraction", "חילוץ AI")}
                            </button>
                          </form>
                        )}

                        {heuristicReport?.id ? (
                          <Link
                            href={`/app/documents/${doc.id}/extraction?reportId=${heuristicReport.id}`}
                            className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            {tr(locale, "Heuristic view", "תצוגת יוריסטי")}
                          </Link>
                        ) : (
                          <form action={requestExtractionAction}>
                            <input type="hidden" name="document_id" value={doc.id} />
                            <input type="hidden" name="extraction_mode" value="heuristic" />
                            <button
                              type="submit"
                              className="rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                            >
                              {tr(locale, "Heuristic extraction", "חילוץ יוריסטי")}
                            </button>
                          </form>
                        )}
                      </>
                    ) : null}

                    <form action={openOriginalDocumentAction}>
                      <input type="hidden" name="document_id" value={doc.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-sky-300 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                      >
                        {tr(locale, "Original file", "קובץ מקור")}
                      </button>
                    </form>

                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="document_id" value={doc.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        {tr(locale, "Delete", "מחיקה")}
                      </button>
                    </form>
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
