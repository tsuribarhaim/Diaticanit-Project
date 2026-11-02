"use client";

import { NavLink as Link } from "@/components/nav-link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useActionState, useEffect, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { updateSimpleProfileFieldAction, type QuickEditState } from "@/app/app/profile/actions";
import { LocalDateTime } from "@/components/local-time";
import { directionForLocale, tr, type AppLocale } from "@/lib/locale";

/**
 * Shared building blocks behind every chevron row on the redesigned Profile
 * page - one small modal/bottom-sheet shell (QuickEditSheet), one
 * presentational row (ProfileRow), and generic field editors wired to
 * updateSimpleProfileFieldAction (QuickScalarFieldRow) or a plain boolean
 * toggle (QuickBooleanFieldRow) for the many rows that don't need their own
 * bespoke form - only the genuinely multi-field rows (exercise preferences,
 * medical conditions, medications, habits, identity) get their own small
 * purpose-built components elsewhere.
 */

function ChevronIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400 rtl:-scale-x-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

export function ToggleSwitch({
  checked,
  disabled,
  onClick,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-10 shrink-0 rounded-full before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] disabled:opacity-60 ${checked ? "bg-teal-600" : "bg-slate-300 dark:bg-slate-700"}`}
    >
      {/* Logical start/end positioning (not a transform), so the knob lands
          on the correct physical side automatically in both LTR and RTL. */}
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${checked ? "end-0.5" : "start-0.5"}`}
      />
    </button>
  );
}

export function ProfileRowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {children}
    </div>
  );
}

export function ProfileSectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="mb-2 mt-6 px-1 first:mt-0">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

export function ProfileRow({
  label,
  value,
  caption,
  onClick,
  href,
  disabled,
  tag,
  endSlot,
  rightIcon = "chevron",
  variant = "default",
  ariaValue,
  labelWeight = "semibold",
}: {
  label: string;
  /** "normal" only for the Language and Display mode rows on Settings (TCK-175). */
  labelWeight?: "semibold" | "normal";
  value?: string;
  /** Overrides `value` in the row's combined aria-label (e.g. a spelled-out
   * unit, "160 centimeters", where the visible value says "160 cm"). */
  ariaValue?: string;
  /** Usually a plain translated string - ReactNode only so a caller can
   * embed a client-rendered value (e.g. LocalDateTime, for a timestamp
   * that needs the visitor's own timezone - see local-time.tsx) inside an
   * otherwise-static sentence. */
  caption?: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  /** e.g. "Coming soon" - a small muted pill instead of a value/chevron. */
  tag?: string;
  endSlot?: ReactNode;
  rightIcon?: "chevron" | "external" | "none";
  variant?: "default" | "danger";
}) {
  const labelClass = variant === "danger" ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-slate-100";
  const isInteractive = Boolean((onClick || href) && !disabled);

  const spokenValue = ariaValue ?? value;
  const ariaLabel = spokenValue ? `${label}, ${spokenValue}` : label;

  // Label and value share one wrapping container, so a long value drops
  // under the label instead of being truncated (and grows with large fonts).
  const inner = (
    <>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0">
          <p className={`text-sm ${labelWeight === "normal" ? "font-normal" : "font-semibold"} ${labelClass}`}>{label}</p>
          {caption ? <p className="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">{caption}</p> : null}
        </div>
        {value ? <span className="break-words text-sm text-slate-600 dark:text-slate-400">{value}</span> : null}
      </div>
      {tag ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {tag}
        </span>
      ) : null}
      {endSlot}
      {!endSlot && !tag && isInteractive && rightIcon === "chevron" ? <ChevronIcon /> : null}
      {!endSlot && !tag && isInteractive && rightIcon === "external" ? <ExternalIcon /> : null}
    </>
  );

  const className = `flex w-full min-h-11 items-center gap-3 px-4 py-2.5 text-start ${
    disabled ? "opacity-60" : isInteractive ? "hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800/60 dark:active:bg-slate-800" : ""
  }`;

  if (href && !disabled) {
    // NavLink wraps its children in its own pending-state <span>, so the
    // row's flex layout is repeated on that span - otherwise the chevron
    // drops under the label instead of sitting at the row's end.
    return (
      <Link href={href} aria-label={ariaLabel} className={`${className} [&>span]:flex [&>span]:min-w-0 [&>span]:flex-1 [&>span]:items-center [&>span]:gap-3`}>
        {inner}
      </Link>
    );
  }
  if (onClick && !disabled) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}

/** A row that expands in place to reveal more rows below it, instead of
 * opening a sheet - used for "sections within a section" (Data & privacy's
 * two placeholder items, Medical documents' upload form + list) where the
 * content belongs inline in the page's own scroll, not a modal. */
export function ExpandableRow({ label, value, caption, children }: { label: string; value?: string; caption?: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <ProfileRow
        label={label}
        value={value}
        caption={caption}
        onClick={() => setIsOpen((previous) => !previous)}
        endSlot={
          <svg
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" className="rtl:-scale-x-100" />
          </svg>
        }
      />
      {isOpen ? <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">{children}</div> : null}
    </div>
  );
}

export function QuickEditSheet({
  locale,
  isOpen,
  onClose,
  title,
  helpText,
  children,
}: {
  locale: AppLocale;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  helpText?: string;
  children: ReactNode;
}) {
  if (!isOpen) return null;
  // The app sets data-theme on its own wrapper, which this portal into document.body sits outside of: carry it over so dark mode applies (same as add-user-dialog / saved-list-quick-picker).
  const theme = document.querySelector("[data-theme]")?.getAttribute("data-theme") ?? undefined;

  // A bottom sheet on mobile, a centered modal on desktop - both from the
  // same markup via `items-end sm:items-center`, no viewport measurement
  // needed (unlike the taller, keyboard-sensitive chat sheets elsewhere in
  // this app - these are short forms that just need native scroll if they
  // overflow, not a computed height/position).
  return createPortal(
    <div dir={directionForLocale(locale)} data-theme={theme} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div role="presentation" onClick={onClose} className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" />
      <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:max-w-md sm:rounded-2xl sm:p-6">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700 sm:hidden" />
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        {helpText ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helpText}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function SheetActions({ locale, onCancel }: { locale: AppLocale; onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        {tr(locale, "Cancel", "ביטול")}
      </button>
      <button
        type="submit"
        disabled={pending}
        className="flex-1 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        {pending ? tr(locale, "Saving…", "שומר…") : tr(locale, "Save", "שמירה")}
      </button>
    </div>
  );
}

const fieldInputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

/** After a successful quick-edit: close the sheet, then either refresh in
 * place or - when this save changed something the active Targets plan was
 * generated from - navigate to the same `?targetsStale=1` staleness banner
 * updateProfileAction's own full-form save already triggers. Shared by every
 * row component below (and the avatar color popover, whose AvatarActionState
 * has a differently-typed but equally truthy `success`) so this behavior
 * can't drift between them - accepting the setter as a parameter, rather
 * than each caller closing over its own useState setter inside its own
 * inline effect, is also what keeps this out of the
 * react-hooks/set-state-in-effect lint rule's reach: it only flags a setState
 * call the static analysis can trace back to a same-scope useState call. */
export function useQuickEditSuccessEffect(
  state: { success?: unknown; targetsStale?: boolean },
  isOpen: boolean,
  setIsOpen: (open: boolean) => void,
) {
  const router = useRouter();
  useEffect(() => {
    if (!state.success) return;
    setIsOpen(false);
    if (state.targetsStale) {
      router.push("/app/profile?targetsStale=1");
    } else {
      router.refresh();
    }
    // Only re-run when the action actually produced a fresh success state -
    // intentionally not depending on isOpen/setIsOpen/router, which don't
    // themselves signal a new result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

/**
 * One generic editor for every SIMPLE scalar row (text/number/select) that
 * saves through updateSimpleProfileFieldAction - covers roughly a dozen rows
 * across Sections 1 and 2 (height, weight, activity level, dietary
 * preference, nutritional goal, pregnancy/lactation status, additional
 * information...) without a bespoke component for each one.
 */
// Mirrors sanitizeWeightInput in profile-edit-form.tsx (TCK-155).
function sanitizeOneDecimalInput(raw: string): string {
  const digitsAndDots = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  const singleDot = firstDot === -1 ? digitsAndDots : digitsAndDots.slice(0, firstDot + 1) + digitsAndDots.slice(firstDot + 1).replace(/\./g, "");
  return singleDot.replace(/^(\d*\.\d)\d+$/, "$1");
}

export function QuickScalarFieldRow({
  locale,
  label,
  field,
  value,
  displayValue,
  caption,
  kind,
  unit,
  options,
  min,
  max,
  step,
  maxLength,
  placeholder,
  helpText,
  display = "row",
  ariaValue,
  emptyValue,
  oneDecimal,
}: {
  locale: AppLocale;
  label: string;
  field: string;
  value: string;
  displayValue?: string;
  caption?: string;
  display?: "row" | "tile";
  ariaValue?: string;
  /** Shown instead of an empty value for text/textarea fields (e.g. "+ Add"). */
  emptyValue?: string;
  kind: "text" | "number" | "select" | "textarea";
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  placeholder?: string;
  helpText?: string;
  /** Text input that only accepts digits and one decimal digit (comma becomes a dot) - TCK-155. */
  oneDecimal?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, formAction] = useActionState(updateSimpleProfileFieldAction, {} as QuickEditState);

  useQuickEditSuccessEffect(state, isOpen, setIsOpen);

  const isEmptyText = (kind === "text" || kind === "textarea") && !value.trim() && emptyValue;
  const shownValue = isEmptyText ? emptyValue : displayValue ?? (unit ? `${value} ${unit}` : value);
  // Draft resets here, right before opening, rather than via an effect
  // watching `isOpen`/`value` - it's invisible while the sheet is closed
  // either way, so there's nothing to synchronize outside a render.
  const open = () => {
    setDraft(value);
    setIsOpen(true);
  };

  return (
    <>
      {display === "tile" ? (
        <ProfileTile label={label} value={shownValue} onClick={open} ariaLabel={`${label}, ${ariaValue ?? shownValue}`} />
      ) : (
        <ProfileRow label={label} value={shownValue} ariaValue={ariaValue} caption={caption} onClick={open} />
      )}
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={label} helpText={helpText}>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="preferred_language" value={locale} />
          {kind === "select" ? (
            <select name="value" value={draft} onChange={(event) => setDraft(event.target.value)} className={fieldInputClass}>
              {options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : kind === "textarea" ? (
            <textarea
              name="value"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={maxLength}
              rows={4}
              placeholder={placeholder}
              className={`${fieldInputClass} resize-none`}
            />
          ) : (
            <div className="flex items-center gap-2">
              <input
                type={!oneDecimal && kind === "number" ? "number" : "text"}
                inputMode={oneDecimal ? "decimal" : undefined}
                autoComplete={oneDecimal ? "off" : undefined}
                name="value"
                value={draft}
                onChange={(event) => {
                  if (!oneDecimal) {
                    setDraft(event.target.value);
                    return;
                  }
                  const el = event.currentTarget;
                  const cleaned = sanitizeOneDecimalInput(el.value);
                  if (cleaned !== el.value) el.value = cleaned;
                  setDraft(cleaned);
                }}
                min={oneDecimal ? undefined : min}
                max={oneDecimal ? undefined : max}
                step={oneDecimal ? undefined : step}
                maxLength={maxLength}
                placeholder={placeholder}
                className={fieldInputClass}
              />
              {unit ? <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{unit}</span> : null}
            </div>
          )}
          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <SheetActions locale={locale} onCancel={() => setIsOpen(false)} />
        </form>
      </QuickEditSheet>
    </>
  );
}

/** A plain boolean profile field (e.g. "Hot climate / heavy sweating") - an
 * inline toggle rather than a sheet, since there's nothing to review before
 * saving a single on/off switch. Submits updateSimpleProfileFieldAction
 * directly (not through useActionState/a <form>) since there's no form UI to
 * manage - just a click that either takes effect or reverts. */
function QuickBooleanFieldRowImpl({
  locale,
  label,
  caption,
  field,
  checked,
}: {
  locale: AppLocale;
  label: string;
  caption?: string;
  field: string;
  checked: boolean;
}) {
  const [optimistic, setOptimistic] = useState(checked);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("field", field);
      formData.set("value", String(next));
      formData.set("preferred_language", locale);
      const result = await updateSimpleProfileFieldAction({}, formData);
      if (result.error) {
        setOptimistic(!next);
        return;
      }
      if (result.targetsStale) {
        router.push("/app/profile?targetsStale=1");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <ProfileRow
      label={label}
      caption={caption}
      endSlot={<ToggleSwitch checked={optimistic} disabled={isPending} onClick={toggle} ariaLabel={label} />}
    />
  );
}

/** Keyed by the real `checked` value so a change coming from OUTSIDE this
 * component (e.g. a router.refresh() after some other save updated it)
 * remounts with a fresh initial state instead of needing an effect to
 * reconcile local state with an updated prop - the pattern React's own docs
 * recommend in place of "adjusting state when a prop changes". */
export function QuickBooleanFieldRow(props: { locale: AppLocale; label: string; caption?: string; field: string; checked: boolean }) {
  return <QuickBooleanFieldRowImpl key={String(props.checked)} {...props} />;
}

/** A compact metric card (age, height, BMI...) for the Profile page's tile
 * grid - a button when tappable, a muted static card when it's computed. */
export function ProfileTile({
  label,
  value,
  sublabel,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
  onClick?: () => void;
  ariaLabel: string;
}) {
  const content = (
    <>
      <span className="block text-[13px] text-slate-600 dark:text-slate-400">{label}</span>
      <span className="mt-0.5 block break-words text-base font-bold text-slate-900 dark:text-slate-100">{value}</span>
      {sublabel ? <span className="mt-0.5 block text-[13px] text-slate-600 dark:text-slate-400">{sublabel}</span> : null}
    </>
  );
  const baseClass = "min-h-16 w-full min-w-0 rounded-2xl border border-slate-200 px-2 py-2.5 text-center dark:border-slate-800";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={`${baseClass} bg-white hover:bg-slate-50 active:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800/60 dark:active:bg-slate-800`}
      >
        {content}
      </button>
    );
  }
  return (
    <div role="group" aria-label={ariaLabel} className={`${baseClass} bg-slate-50 dark:bg-slate-900/60`}>
      {content}
    </div>
  );
}

function WarningIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/** Marks a field whose content the AI treats as a safety constraint
 * (allergies, medical conditions, medications & supplements). */
export function SafetyTag({ locale }: { locale: AppLocale }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-bold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      <WarningIcon className="h-3 w-3" />
      <span aria-hidden="true">{tr(locale, "Safety", "בטיחות")}</span>
      <span className="sr-only">{tr(locale, "safety field", "שדה בטיחות")}</span>
    </span>
  );
}

const MAX_VISIBLE_CHIPS = 8;

/** A list field shown as wrapping chips - every chip (and "+ Add") opens
 * the field's existing list editor. */
export function ProfileChipField({
  label,
  safety,
  locale,
  tone,
  items,
  chipAriaPrefix,
  emptyLabel,
  addLabel,
  onOpen,
}: {
  label: string;
  safety?: boolean;
  locale: AppLocale;
  tone: "warning" | "neutral";
  items: string[];
  chipAriaPrefix: string;
  emptyLabel?: string;
  addLabel: string;
  onOpen: () => void;
}) {
  const visible = items.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenCount = items.length - visible.length;
  const chipBase = "inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm";
  const toneClass =
    tone === "warning"
      ? "border-rose-200 bg-rose-50 font-semibold text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
      : "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";
  const mutedClass = "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400";

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</p>
        {safety ? <SafetyTag locale={locale} /> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.map((item, index) => (
          <button key={`${item}-${index}`} type="button" onClick={onOpen} aria-label={`${chipAriaPrefix}: ${item}`} className={`${chipBase} ${toneClass}`}>
            {tone === "warning" ? <WarningIcon className="h-3.5 w-3.5 shrink-0" /> : null}
            <span className="break-words">{item}</span>
          </button>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={tr(locale, `${hiddenCount} more`, `עוד ${hiddenCount} פריטים`)}
            className={`${chipBase} ${mutedClass}`}
          >
            {tr(locale, `+${hiddenCount} more`, `עוד ${hiddenCount}`)}
          </button>
        ) : null}
        {items.length === 0 && emptyLabel ? (
          <button type="button" onClick={onOpen} className={`${chipBase} ${mutedClass}`}>
            {emptyLabel}
          </button>
        ) : null}
        {items.length === 0 ? (
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400"
          >
            {addLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Starting weight is derived from the first Daily Report weigh-in (no
 * column of its own), so its tile opens a read-only sheet. */
export function StartingWeightTile({
  locale,
  value,
  reportAt,
}: {
  locale: AppLocale;
  /** Already formatted, e.g. "64 kg" - null when nothing's been logged yet. */
  value: string | null;
  reportAt: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = tr(locale, "Starting weight", "משקל התחלתי");
  const shownValue = value ?? tr(locale, "Not logged yet", "עדיין לא נרשם");

  return (
    <>
      <ProfileTile label={label} value={shownValue} onClick={() => setIsOpen(true)} ariaLabel={`${label}, ${shownValue}`} />
      <QuickEditSheet locale={locale} isOpen={isOpen} onClose={() => setIsOpen(false)} title={label}>
        <div className="space-y-3">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{shownValue}</p>
          {reportAt ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {tr(locale, "First weigh-in: ", "שקילה ראשונה: ")}
              <LocalDateTime value={reportAt} locale={locale} />
            </p>
          ) : null}
          <p className="text-[13px] text-slate-600 dark:text-slate-400">
            {tr(locale, "Set automatically from your first Daily Report weigh-in.", "נקבע אוטומטית לפי השקילה הראשונה בדיווח היומי.")}
          </p>
          <Link href="/app/daily-report" className="inline-flex min-h-11 items-center text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">
            {tr(locale, "Go to Daily Report", "מעבר לדיווח היומי")}
          </Link>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {tr(locale, "Close", "סגירה")}
          </button>
        </div>
      </QuickEditSheet>
    </>
  );
}
