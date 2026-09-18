"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateAiConsentAction } from "@/app/app/profile/actions";
import { PasskeyManager } from "@/components/passkey-manager";
import { ExpandableRow, ProfileRow, QuickEditSheet, ToggleSwitch } from "@/components/profile-quick-edit";
import { tr, type AppLocale } from "@/lib/locale";

/** A plain "coming soon" row - visible and correctly placed in the
 * information architecture, but inert: none of Notifications, Connected
 * Apps & Devices, Measurement Units, Data export, or Account deletion have
 * any implementation behind them yet (see the Profile redesign discussion -
 * each is its own separate build). */
export function ComingSoonRow({ label, locale, caption }: { label: string; locale: AppLocale; caption?: string }) {
  return <ProfileRow label={label} caption={caption} tag={tr(locale, "Coming soon", "בקרוב")} disabled />;
}

export function DataPrivacyRow({ locale }: { locale: AppLocale }) {
  return (
    <ExpandableRow label={tr(locale, "Data & privacy", "נתונים ופרטיות")}>
      <div className="space-y-1 -mx-1">
        <ComingSoonRow locale={locale} label={tr(locale, "Export my data", "ייצוא הנתונים שלי")} />
        <ProfileRow label={tr(locale, "Delete my account", "מחיקת החשבון שלי")} tag={tr(locale, "Coming soon", "בקרוב")} disabled variant="danger" />
      </div>
    </ExpandableRow>
  );
}

export function PasskeysRow({ locale }: { locale: AppLocale }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <ProfileRow label={tr(locale, "Passkeys", "מפתחות גישה")} onClick={() => setIsOpen(true)} />
      <QuickEditSheet
        locale={locale}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={tr(locale, "Passkeys", "מפתחות גישה")}
        helpText={tr(
          locale,
          "Sign in with Face ID, Touch ID, Windows Hello, or a security key instead of typing your password.",
          "התחברו עם זיהוי פנים, טביעת אצבע, Windows Hello, או מפתח אבטחה במקום הקלדת הסיסמה.",
        )}
      >
        <PasskeyManager locale={locale} />
      </QuickEditSheet>
    </>
  );
}

/** The one required-for-AI toggle on the page - separate from
 * updateSimpleProfileFieldAction's whitelist since it writes to
 * ai_extraction_consents, a different table, via its own action
 * (updateAiConsentAction). */
function AiConsentToggleRowImpl({ locale, checked }: { locale: AppLocale; checked: boolean }) {
  const [optimistic, setOptimistic] = useState(checked);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    startTransition(async () => {
      const result = await updateAiConsentAction(next);
      if (result.error) {
        setOptimistic(!next);
        return;
      }
      router.refresh();
    });
  }

  return (
    <ProfileRow
      label={tr(locale, "Let AI use my data", "לאפשר ל-AI להשתמש בנתונים שלי")}
      caption={tr(locale, "Required for AI-generated targets & coaching", "נדרש ליעדים ולהדרכה שנוצרים באמצעות AI")}
      endSlot={<ToggleSwitch checked={optimistic} disabled={isPending} onClick={toggle} ariaLabel={tr(locale, "Let AI use my data", "לאפשר ל-AI להשתמש בנתונים שלי")} />}
    />
  );
}

/** Keyed by `checked` - see QuickBooleanFieldRow's own comment in
 * profile-quick-edit.tsx for why this replaces a props-sync effect. */
export function AiConsentToggleRow(props: { locale: AppLocale; checked: boolean }) {
  return <AiConsentToggleRowImpl key={String(props.checked)} {...props} />;
}
