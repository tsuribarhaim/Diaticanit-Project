"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  type DocumentsActionState,
  uploadDocumentAction,
} from "@/app/app/documents/actions";
import { ALLOWED_DOCUMENT_MIME_TYPES } from "@/lib/documents";
import type { AppLocale } from "@/lib/locale";
import { tr } from "@/lib/locale";

const initialState: DocumentsActionState = {};

function UploadButton({ locale }: { locale: AppLocale }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70 hover:bg-teal-800"
    >
      {pending ? tr(locale, "Uploading...", "מעלה קובץ...") : tr(locale, "Upload", "העלאה")}
    </button>
  );
}

/**
 * The native file input's own "Choose File" / "No file chosen" text comes
 * from the browser's UI locale, not the page's `lang` attribute - there's no
 * way to translate it directly. Hiding the real input (kept functional via
 * sr-only, not display:none, so it stays clickable/keyboard-reachable and
 * still participates in form submission and native required-validation) and
 * driving it from our own button + filename text is the standard workaround.
 */
function FileField({ locale }: { locale: AppLocale }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "File", "קובץ")}</span>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-300 px-3 py-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {tr(locale, "Choose file", "בחירת קובץ")}
        </button>
        <span className="truncate text-sm text-slate-600">{fileName ?? tr(locale, "No file chosen", "לא נבחר קובץ")}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        name="file"
        required
        accept={ALLOWED_DOCUMENT_MIME_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
      />
    </div>
  );
}

export function DocumentUploadForm({ locale }: { locale: AppLocale }) {
  const [state, formAction] = useActionState(uploadDocumentAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{tr(locale, "Category", "קטגוריה")}</span>
        <input
          type="text"
          name="category"
          required
          maxLength={50}
          placeholder={tr(locale, "e.g. blood report", "לדוגמה: בדיקת דם")}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2"
        />
      </label>

      <FileField locale={locale} />

      <p className="text-xs text-slate-500">
        {tr(locale, "Max size 10 MB. Allowed: PDF, PNG, JPG, WEBP, TXT.", "גודל מרבי 10MB. מותר: PDF, PNG, JPG, WEBP, TXT.")}
      </p>

      {state.error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <UploadButton locale={locale} />
    </form>
  );
}
