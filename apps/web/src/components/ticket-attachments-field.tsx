"use client";

import { useEffect, useRef, useState } from "react";

import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, formatFileSize } from "@/lib/documents";
import { MAX_TICKET_ATTACHMENTS } from "@/lib/tickets";
import { tr, type AppLocale } from "@/lib/locale";

type Attachment = { id: string; file: File; previewUrl: string | null };

function fileIcon(mimeType: string) {
  if (mimeType === "application/pdf") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

/**
 * Multi-file attachments for the New Ticket form: browse, drag-and-drop,
 * or paste an image directly into the description field (see
 * new-ticket-form.tsx, which forwards paste events here via onFilesAdded).
 * Keeps the managed File[] in React state for the thumbnail grid, but
 * mirrors it into a real hidden <input type="file" multiple> via
 * DataTransfer so the surrounding <form action={formAction}> (a plain
 * useActionState-bound native form, same pattern as the rest of this
 * form) picks every file up in its own FormData on submit with no manual
 * FormData construction - this was chosen over calling the server action
 * directly specifically to keep that native-form-submission shape intact.
 */
export function TicketAttachmentsField({
  locale,
  attachments,
  flash,
  onAdd,
  onRemove,
  registerFileInputRef,
}: {
  locale: AppLocale;
  attachments: Attachment[];
  /** The most recent rejection message, from ANY source - browse, drop, or
   * a paste in the description field elsewhere in the form (see
   * useTicketAttachments, which owns this so all three share one visible
   * message instead of paste failing silently with nothing shown). */
  flash: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Lets the parent form clear the hidden input on successful submit. */
  registerFileInputRef?: (el: HTMLInputElement | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    registerFileInputRef?.(fileInputRef.current);
  }, [registerFileInputRef]);

  // Keeps the hidden native input's .files in sync with the managed list
  // whenever it changes (add or remove), regardless of which of the three
  // ways (browse/drop/paste) a file just came from.
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const dataTransfer = new DataTransfer();
    attachments.forEach((attachment) => dataTransfer.items.add(attachment.file));
    input.files = dataTransfer.files;
  }, [attachments]);

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {tr(locale, "Attachments (optional)", "קבצים מצורפים (אופציונלי)")}
      </span>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          if (event.dataTransfer.files.length) onAdd(Array.from(event.dataTransfer.files));
        }}
        className={`cursor-pointer rounded-xl border-[1.5px] border-dashed px-4 py-4 text-center transition-colors ${
          isDragOver
            ? "border-teal-600 bg-teal-50 dark:bg-teal-950/30"
            : "border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600"
        }`}
      >
        <svg
          className="mx-auto text-slate-400 dark:text-slate-500"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="mt-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
          {tr(
            locale,
            "Drag files here, click to browse, or paste an image into the description",
            "גררו קבצים לכאן, לחצו לבחירה, או הדביקו תמונה לתוך שדה התיאור",
          )}
        </p>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          {tr(
            locale,
            `PDF, PNG, JPG, WEBP, or text — up to 10 MB each, ${MAX_TICKET_ATTACHMENTS} files max`,
            `PDF, PNG, JPG, WEBP או טקסט — עד 10MB לקובץ, עד ${MAX_TICKET_ATTACHMENTS} קבצים`,
          )}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          name="attachments"
          multiple
          accept={ALLOWED_DOCUMENT_MIME_TYPES.join(",")}
          onChange={(event) => {
            if (event.target.files?.length) onAdd(Array.from(event.target.files));
          }}
          onClick={(event) => event.stopPropagation()}
          className="hidden"
        />
      </div>

      {flash ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400">
          {flash}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60">
                {attachment.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a transient blob: preview URL for a not-yet-uploaded local File, not an app asset next/image can optimize.
                  <img src={attachment.previewUrl} alt={attachment.file.name} className="h-16 w-full object-cover" />
                ) : (
                  <div className="flex h-16 w-full items-center justify-center text-slate-400 dark:text-slate-500">
                    {fileIcon(attachment.file.type)}
                  </div>
                )}
                <div className="px-1.5 py-1">
                  <p className="truncate text-[10px] font-semibold text-slate-700 dark:text-slate-300" title={attachment.file.name}>
                    {attachment.file.name}
                  </p>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">{formatFileSize(attachment.file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(attachment.id)}
                  aria-label={tr(locale, `Remove ${attachment.file.name}`, `הסרת ${attachment.file.name}`)}
                  className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-rose-600"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-end text-xs text-slate-400 dark:text-slate-500">
            {tr(
              locale,
              `${attachments.length} of ${MAX_TICKET_ATTACHMENTS} files attached`,
              `${attachments.length} מתוך ${MAX_TICKET_ATTACHMENTS} קבצים צורפו`,
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}

/**
 * Owns the attachment list AND the rejection flash message, so every
 * source that can add a file - the field's own browse/drop, or a paste
 * event on the description textarea elsewhere in the form - shows the
 * same visible message on rejection instead of a paste failing silently.
 *
 * `baselineCount` lets the edit form (TicketEditForm) count already-
 * uploaded attachments still staying on the ticket toward the same
 * MAX_TICKET_ATTACHMENTS cap this hook enforces for newly-added files -
 * the create form never has any (defaults to 0, its previous behavior
 * unchanged); the caller is responsible for keeping it in sync with its
 * own "how many existing attachments am I about to remove" state.
 */
export function useTicketAttachments(locale: AppLocale, baselineCount = 0) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  // Revoke every blob: preview URL on unmount so a long ticket-form
  // session (several add/remove cycles) doesn't leak memory.
  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only, intentionally runs once on unmount against whatever attachments held at that time.
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timeout = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(timeout);
  }, [flash]);

  function addFiles(files: File[]) {
    let rejection: string | null = null;
    const accepted: Attachment[] = [];

    for (const file of files) {
      if (baselineCount + attachments.length + accepted.length >= MAX_TICKET_ATTACHMENTS) {
        rejection = tr(
          locale,
          `Only ${MAX_TICKET_ATTACHMENTS} attachments allowed — remove one to add another.`,
          `מותר עד ${MAX_TICKET_ATTACHMENTS} קבצים — יש להסיר אחד כדי להוסיף חדש.`,
        );
        break;
      }
      if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as never)) {
        rejection = tr(locale, `"${file.name}" isn't a supported file type.`, `"${file.name}" אינו סוג קובץ נתמך.`);
        continue;
      }
      if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
        rejection = tr(locale, `"${file.name}" is over the 10 MB limit.`, `"${file.name}" חורג מהמגבלה של 10MB.`);
        continue;
      }
      accepted.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      });
    }

    if (accepted.length > 0) setAttachments((previous) => [...previous, ...accepted]);
    setFlash(rejection);
  }

  function removeFile(id: string) {
    setAttachments((previous) => {
      const target = previous.find((attachment) => attachment.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return previous.filter((attachment) => attachment.id !== id);
    });
  }

  return { attachments, flash, addFiles, removeFile };
}
