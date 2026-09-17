"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setAvatarColorAction, type AvatarActionState } from "@/app/app/profile/actions";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_COLOR_IDS, AVATAR_COLOR_HEX, type AvatarColorId } from "@/lib/avatar-colors";
import { tr, type AppLocale } from "@/lib/locale";

const initialState: AvatarActionState = {};

/**
 * Every swatch IS a submit button carrying its own name="color" value -
 * clicking one submits immediately, exactly like a native radio-button
 * group but with zero extra JS: no onClick handlers, no local "which one is
 * selected" state to keep in sync with the server. Disabled while any
 * submit is in flight so a second click can't race the first.
 */
function ColorSwatchButton({ color, isSelected, ariaLabel }: { color: AvatarColorId; isSelected: boolean; ariaLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="color"
      value={color}
      disabled={pending}
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      style={{ backgroundColor: AVATAR_COLOR_HEX[color] }}
      className={`h-8 w-8 rounded-full outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isSelected ? "ring-2 ring-offset-2 ring-slate-900" : "hover:ring-2 hover:ring-offset-2 hover:ring-slate-300"
      }`}
    />
  );
}

/**
 * Lives on the Profile page (not the edit form) - same placement precedent
 * as DocumentUploadForm: a standalone small action card rather than a field
 * folded into the big multi-field edit form. A solid-color circle showing
 * the user's own initial, with a small palette to pick the color from - no
 * upload, no icon set, per "keep it clear and lean".
 */
export function AvatarColorPicker({
  locale,
  currentColor,
  name,
}: {
  locale: AppLocale;
  currentColor: AvatarColorId;
  name: string | null;
}) {
  const [state, formAction] = useActionState(setAvatarColorAction, initialState);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar
        avatarColor={currentColor}
        name={name}
        className="h-16 w-16 text-xl"
        alt={tr(locale, "Profile picture", "תמונת פרופיל")}
      />
      <form action={formAction} className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-600">
            {tr(locale, "Choose a color", "בחירת צבע")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {AVATAR_COLOR_IDS.map((color) => (
              <ColorSwatchButton key={color} color={color} isSelected={currentColor === color} ariaLabel={color} />
            ))}
          </div>
        </div>
        {state.error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{state.error}</p>
        ) : null}
      </form>
    </div>
  );
}
