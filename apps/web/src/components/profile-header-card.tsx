"use client";

import { startTransition, useActionState, useOptimistic, useState } from "react";
import { useFormStatus } from "react-dom";

import { setAvatarColorAction, updateIdentityAction, type AvatarActionState, type QuickEditState } from "@/app/app/profile/actions";
import { QuickEditSheet, SheetActions, useQuickEditSuccessEffect } from "@/components/profile-quick-edit";
import { LocalizedDateInput } from "@/components/localized-date-input";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_COLOR_HEX, AVATAR_COLOR_IDS, type AvatarColorId } from "@/lib/avatar-colors";
import { directionForLocale, tr, type AppLocale } from "@/lib/locale";

function PencilIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.862 4.487a2.06 2.06 0 1 1 2.915 2.914L7.5 19.68l-4 1 1-4L16.862 4.487Z" />
    </svg>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/** The color swatches themselves, as their own component so useFormStatus
 * (which only sees a <form> from inside one of its descendants, not from
 * the component that renders the <form> tag) can report whether a swatch
 * tap is still in flight - previously each swatch just submitted with no
 * feedback at all, reported as "no clue if it got the request or not".
 * onPick fires the optimistic avatar-color update (see ProfileHeaderCard's
 * useOptimistic) alongside the real form submission, so the avatar itself
 * updates the instant a swatch is tapped instead of waiting on the round
 * trip - reported as the color change itself feeling slow, separately from
 * the missing feedback. */
function AvatarColorSwatches({
  locale,
  currentColor,
  onPick,
}: {
  locale: AppLocale;
  currentColor: AvatarColorId;
  onPick: (color: AvatarColorId) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <div className="flex flex-wrap justify-center gap-3">
        {AVATAR_COLOR_IDS.map((color) => (
          <button
            key={color}
            type="submit"
            name="color"
            value={color}
            disabled={pending}
            onClick={() => startTransition(() => onPick(color))}
            aria-label={color}
            aria-pressed={currentColor === color}
            style={{ backgroundColor: AVATAR_COLOR_HEX[color] }}
            className={`h-10 w-10 rounded-full outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${
              currentColor === color
                ? "ring-2 ring-offset-2 ring-slate-900 dark:ring-slate-100 dark:ring-offset-slate-900"
                : "hover:ring-2 hover:ring-offset-2 hover:ring-slate-300 dark:hover:ring-slate-600 dark:ring-offset-slate-900"
            }`}
          />
        ))}
      </div>
      {pending ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <Spinner className="h-3.5 w-3.5 animate-spin" />
          {tr(locale, "Saving…", "שומר…")}
        </p>
      ) : null}
    </>
  );
}

/**
 * The avatar's color swatches, previously always visible on the Profile page
 * (see the old AvatarColorPicker), now tucked behind the small pencil badge
 * on the avatar itself and shown in a popover on tap - the same underlying
 * setAvatarColorAction, just a lighter-weight trigger for it.
 */
function AvatarColorPopover({
  locale,
  currentColor,
  onPick,
}: {
  locale: AppLocale;
  currentColor: AvatarColorId;
  onPick: (color: AvatarColorId) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction] = useActionState(setAvatarColorAction, {} as AvatarActionState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={tr(locale, "Edit avatar color", "עריכת צבע האווטאר")}
        className="absolute -end-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-teal-700 text-white hover:bg-teal-800 dark:border-slate-900 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        <PencilIcon className="h-3 w-3" />
      </button>
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={tr(locale, "Avatar color", "צבע האווטאר")}>
        <form action={formAction}>
          <input type="hidden" name="preferred_language" value={locale} />
          <AvatarColorSwatches locale={locale} currentColor={currentColor} onPick={onPick} />
          {state.error ? <p className="mt-3 text-center text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
        </form>
      </QuickEditSheet>
    </>
  );
}

/** Owns its own trigger button (not just the sheet) so opening and
 * resetting the drafts to the latest saved values can happen in one place,
 * right in the button's onClick - avoids an effect watching `isOpen` purely
 * to copy props into state on open (the pattern React's own docs flag as an
 * unnecessary effect; see profile-quick-edit.tsx's own comments on the same
 * point for the other rows). */
function EditIdentityButton({
  locale,
  firstName,
  lastName,
  dateOfBirth,
}: {
  locale: AppLocale;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [firstDraft, setFirstDraft] = useState(firstName);
  const [lastDraft, setLastDraft] = useState(lastName);
  const [dobDraft, setDobDraft] = useState(dateOfBirth);
  const [state, formAction] = useActionState(updateIdentityAction, {} as QuickEditState);
  const maxDateOfBirth = new Date().toISOString().slice(0, 10);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFirstDraft(firstName);
          setLastDraft(lastName);
          setDobDraft(dateOfBirth);
          setIsOpen(true);
        }}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        <PencilIcon className="h-3.5 w-3.5" />
        {tr(locale, "Edit Profile", "עריכת פרופיל")}
      </button>
      <QuickEditSheet
        locale={locale}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={tr(locale, "Edit profile", "עריכת פרופיל")}
        helpText={tr(
          locale,
          "Your name and date of birth - the basics that don't fit any single biometric row below.",
          "השם ותאריך הלידה שלך - הפרטים הבסיסיים שלא שייכים לשורת מדד יחידה למטה.",
        )}
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="preferred_language" value={locale} />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "First name", "שם פרטי")}</label>
            <input
              type="text"
              name="first_name"
              value={firstDraft}
              onChange={(event) => setFirstDraft(event.target.value)}
              maxLength={80}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Last name", "שם משפחה")}</label>
            <input
              type="text"
              name="last_name"
              value={lastDraft}
              onChange={(event) => setLastDraft(event.target.value)}
              maxLength={80}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{tr(locale, "Date of birth", "תאריך לידה")}</label>
            <LocalizedDateInput
              locale={locale}
              value={dobDraft}
              onChange={setDobDraft}
              name="date_of_birth"
              max={maxDateOfBirth}
              ariaLabel={tr(locale, "Date of birth", "תאריך לידה")}
            />
          </div>
          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

export function ProfileHeaderCard({
  locale,
  avatarColor,
  firstName,
  lastName,
  dateOfBirth,
  email,
  memberSinceLabel,
}: {
  locale: AppLocale;
  avatarColor: AvatarColorId;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  /** Pre-formatted (e.g. "Member since Mar 2025") - computed server-side
   * from the account's real creation date. */
  memberSinceLabel: string;
}) {
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || tr(locale, "Your profile", "הפרופיל שלך");

  // Shows a tapped color immediately, without waiting for the round trip
  // (reported as the picker feeling slow, on top of the earlier missing
  // feedback) - reverts on its own back to `avatarColor` if the save
  // action fails (that prop never changes in that case), and resolves to
  // the real value once useQuickEditSuccessEffect's router.refresh() lands
  // it. Scoped to this card only - the nav bar's own avatar (AppNav/
  // AppBottomNav, rendered from the layout, not a descendant of this
  // component) still updates on the normal round trip.
  const [optimisticAvatarColor, setOptimisticAvatarColor] = useOptimistic(avatarColor);

  return (
    <div dir={directionForLocale(locale)} className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="relative">
        <UserAvatar avatarColor={optimisticAvatarColor} name={firstName} className="h-20 w-20 text-2xl" alt={tr(locale, "Profile picture", "תמונת פרופיל")} />
        <AvatarColorPopover locale={locale} currentColor={optimisticAvatarColor} onPick={setOptimisticAvatarColor} />
      </div>

      <p className="mt-3 text-lg font-bold text-slate-900 dark:text-slate-100">{fullName}</p>

      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
        {/* No real subscription/tier system exists in this app yet - this is
            a deliberate placeholder badge, not wired to anything, so the
            header layout is ready whenever one exists. */}
        <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-400">
          {tr(locale, "Free plan", "תוכנית חינמית")}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {memberSinceLabel}
        </span>
      </div>

      {email ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{email}</p> : null}

      <EditIdentityButton locale={locale} firstName={firstName} lastName={lastName} dateOfBirth={dateOfBirth} />
    </div>
  );
}
