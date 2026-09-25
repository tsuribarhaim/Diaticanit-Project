"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { updateTicketAction, type TicketFormState } from "@/app/app/tickets/actions";
import { QuickEditSheet, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import { TicketAttachmentsField, useTicketAttachments } from "@/components/ticket-attachments-field";
import { formatFileSize } from "@/lib/documents";
import { formatTicketArea, formatTicketPriority, formatTicketType, tr, type AppLocale } from "@/lib/locale";
import { ticketAreaOptions, ticketPriorityOptions, ticketTypeOptions, type TicketArea, type TicketPriority, type TicketType } from "@/lib/tickets";

const initialState: TicketFormState = {};

const inputClassName =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

function SaveButton({ locale, disabled }: { locale: AppLocale; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
    >
      {pending ? tr(locale, "Saving...", "שומר...") : tr(locale, "Save changes", "שמירת שינויים")}
    </button>
  );
}

type ExistingAttachment = { id: string; fileName: string; mimeType: string; fileSizeBytes: number };

/**
 * The edit form - shown only while isEditableTicketStatus(status) (open,
 * in_progress, or reopened; see lib/tickets.ts). Subject/type/area/
 * priority are plain overwrites; the description itself is never directly
 * editable here - instead there's a "what's new" note (optional, unlike
 * the reopen dialog's required one) that becomes the next dated entry in
 * the ticket's history log, alongside an automatically-generated summary
 * of whatever attributes/attachments actually changed (updateTicketAction
 * computes the real, stored version of that server-side - the preview
 * here is cosmetic, shown in the viewer's own locale for readability,
 * while what actually gets stored is always English, same convention as
 * technical_response).
 */
export function EditTicketDialog({
  locale,
  ticketId,
  ticketSeq,
  currentSubject,
  currentType,
  currentArea,
  currentPriority,
  currentAttachments,
  autoOpen = false,
}: {
  locale: AppLocale;
  ticketId: string;
  ticketSeq: number;
  currentSubject: string;
  currentType: TicketType;
  currentArea: TicketArea;
  currentPriority: TicketPriority;
  currentAttachments: ExistingAttachment[];
  /** Opens the dialog immediately on mount - used when arriving from the
   * My Tickets list's own Edit icon (see page.tsx's `?edit=1` link), so
   * that click deep-links straight into an already-open form instead of
   * landing on the plain detail view and requiring a second click. */
  autoOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [subject, setSubject] = useState(currentSubject);
  const [ticketType, setTicketType] = useState<TicketType>(currentType);
  const [area, setArea] = useState<TicketArea>(currentArea);
  const [priority, setPriority] = useState<TicketPriority>(currentPriority);
  const [note, setNote] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [state, formAction] = useActionState(updateTicketAction, initialState);

  const keptCount = currentAttachments.length - removedIds.size;
  const { attachments: newAttachments, flash, addFiles, removeFile } = useTicketAttachments(locale, keptCount);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  function resetDraft() {
    setSubject(currentSubject);
    setTicketType(currentType);
    setArea(currentArea);
    setPriority(currentPriority);
    setNote("");
    setRemovedIds(new Set());
  }

  const previewLines = useMemo(() => {
    const lines: string[] = [];
    if (subject.trim() !== currentSubject) lines.push(tr(locale, "Subject updated", "הנושא עודכן"));
    if (ticketType !== currentType) lines.push(`${tr(locale, "Type", "סוג")}: ${formatTicketType(currentType, locale)} → ${formatTicketType(ticketType, locale)}`);
    if (area !== currentArea) lines.push(`${tr(locale, "Area", "אזור")}: ${formatTicketArea(currentArea, locale)} → ${formatTicketArea(area, locale)}`);
    if (priority !== currentPriority)
      lines.push(`${tr(locale, "Priority", "עדיפות")}: ${formatTicketPriority(currentPriority, locale)} → ${formatTicketPriority(priority, locale)}`);
    for (const attachment of currentAttachments) {
      if (removedIds.has(attachment.id)) lines.push(tr(locale, `Attachment removed: ${attachment.fileName}`, `קובץ הוסר: ${attachment.fileName}`));
    }
    for (const attachment of newAttachments) {
      lines.push(tr(locale, `Attachment added: ${attachment.file.name}`, `קובץ נוסף: ${attachment.file.name}`));
    }
    return lines;
  }, [subject, ticketType, area, priority, currentSubject, currentType, currentArea, currentPriority, currentAttachments, removedIds, newAttachments, locale]);

  const hasNothingToSave = previewLines.length === 0 && note.trim().length === 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          resetDraft();
          setIsOpen(true);
        }}
        aria-label={tr(locale, "Edit ticket", "עריכת הפנייה")}
        title={tr(locale, "Edit ticket", "עריכת הפנייה")}
        className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400"
      >
        {tr(locale, "Edit Ticket", "עריכת הפנייה")}
      </button>

      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, `Edit Ticket TCK-${ticketSeq}`, `עריכת הפנייה TCK-${ticketSeq}`)}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="ticket_id" value={ticketId} />
          {[...removedIds].map((id) => (
            <input key={id} type="hidden" name="remove_attachment_ids" value={id} />
          ))}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Subject", "נושא")}</span>
            <input type="text" name="subject" required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} className={inputClassName} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Type", "סוג")}</span>
              <select name="ticket_type" required value={ticketType} onChange={(event) => setTicketType(event.target.value as TicketType)} className={inputClassName}>
                {ticketTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatTicketType(option, locale)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Priority", "עדיפות")}</span>
              <select name="priority" required value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)} className={inputClassName}>
                {ticketPriorityOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatTicketPriority(option, locale)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Area", "אזור")}</span>
            <select name="area" required value={area} onChange={(event) => setArea(event.target.value as TicketArea)} className={inputClassName}>
              {ticketAreaOptions.map((option) => (
                <option key={option} value={option}>
                  {formatTicketArea(option, locale)}
                </option>
              ))}
            </select>
          </label>

          {currentAttachments.length > 0 ? (
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Current attachments", "קבצים מצורפים נוכחיים")}</span>
              <div className="flex flex-wrap gap-2">
                {currentAttachments.map((attachment) => {
                  const isRemoved = removedIds.has(attachment.id);
                  return (
                    <span
                      key={attachment.id}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                        isRemoved
                          ? "border-slate-200 bg-slate-50 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-600"
                          : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {attachment.fileName} {attachment.fileSizeBytes ? `(${formatFileSize(attachment.fileSizeBytes)})` : ""}
                      <button
                        type="button"
                        onClick={() =>
                          setRemovedIds((previous) => {
                            const next = new Set(previous);
                            if (next.has(attachment.id)) next.delete(attachment.id);
                            else next.add(attachment.id);
                            return next;
                          })
                        }
                        aria-label={isRemoved ? tr(locale, `Undo removing ${attachment.fileName}`, `ביטול הסרת ${attachment.fileName}`) : tr(locale, `Remove ${attachment.fileName}`, `הסרת ${attachment.fileName}`)}
                        className={isRemoved ? "text-teal-600 hover:underline dark:text-teal-400" : "text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400"}
                      >
                        {isRemoved ? tr(locale, "Undo", "ביטול") : "✕"}
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <TicketAttachmentsField locale={locale} attachments={newAttachments} flash={flash} onAdd={addFiles} onRemove={removeFile} />

          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              previewLines.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400"
            }`}
          >
            {previewLines.length > 0
              ? `${tr(locale, "Will be logged", "יירשם בהיסטוריה")}: ${previewLines.join(" · ")}`
              : tr(locale, "No attribute changes yet - editing the fields or attachments above will show what gets logged here.", "אין עדיין שינויים במאפיינים - עריכת השדות או הקבצים למעלה תציג כאן מה יירשם.")}
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{tr(locale, "Add a note (optional)", "הוספת הערה (אופציונלי)")}</span>
            <textarea
              name="note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr(locale, "Anything else worth adding...", "עוד משהו שכדאי להוסיף...")}
              className={`${inputClassName} resize-none`}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {tr(
                locale,
                "This becomes a new dated entry in the ticket's history, along with any attribute changes above.",
                "זה יהפוך לרשומה חדשה עם תאריך בהיסטוריית הפנייה, יחד עם כל שינוי במאפיינים שלמעלה.",
              )}
            </p>
          </label>

          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {tr(locale, "Cancel", "ביטול")}
            </button>
            <SaveButton locale={locale} disabled={hasNothingToSave} />
          </div>
        </form>
      </QuickEditSheet>
    </>
  );
}
