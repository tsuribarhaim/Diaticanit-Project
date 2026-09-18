import { InfoPopoverButton } from "@/components/info-popover";
import { tr, type AppLocale } from "@/lib/locale";

/**
 * The "?" info popover explaining what "Low"/"High" alcohol consumption
 * mean - shared between profile-edit-form.tsx and onboarding-profile-form.tsx
 * so the standard-drink and threshold definitions live in exactly one place.
 * Reuses InfoPopoverButton (see its own comment) for visual and behavioral
 * consistency with the nutrient info popover in targets-section-tabs.tsx.
 */
export function AlcoholConsumptionInfo({ locale }: { locale: AppLocale }) {
  return (
    <InfoPopoverButton
      ariaLabel={tr(locale, "More information", "מידע נוסף")}
      triggerClassName="flex h-6 w-6 cursor-help items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
      panelWidthClassName="sm:w-72"
      panelSide="start"
    >
      <p className="font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "What counts as a standard drink", "מהי מנת שתייה סטנדרטית")}</p>
      <ul className="mt-1 space-y-1">
        <li>
          🍺{" "}
          {tr(
            locale,
            "A third of a beer (330 ml) at a regular concentration (about 5%).",
            "שליש בקבוק בירה (330 מ\"ל) בריכוז רגיל (כ-5%).",
          )}
        </li>
        <li>
          🍷{" "}
          {tr(
            locale,
            "A glass of wine (about 140–150 ml) at a concentration of about 12%.",
            "כוס יין (כ-140–150 מ\"ל) בריכוז של כ-12%.",
          )}
        </li>
        <li>
          🥃{" "}
          {tr(
            locale,
            "A chaser or shot of a strong drink (about 40 ml) like vodka, whiskey, gin, or tequila (40%).",
            "מנת משקה חריף (כ-40 מ\"ל) כמו וודקה, ויסקי, ג'ין או טקילה (40%).",
          )}
        </li>
      </ul>
      <p className="mt-2 font-semibold text-amber-900 dark:text-amber-400">{tr(locale, "Weekly consumption levels", "רמות צריכה שבועיות")}</p>
      <ul className="mt-1 space-y-1">
        <li>{tr(locale, "Female, low: up to 7 drinks per week.", "נשים, צריכה נמוכה: עד 7 מנות בשבוע.")}</li>
        <li>{tr(locale, "Female, high: 8 drinks or more per week.", "נשים, צריכה גבוהה: 8 מנות או יותר בשבוע.")}</li>
        <li>{tr(locale, "Male, low: up to 14 drinks per week.", "גברים, צריכה נמוכה: עד 14 מנות בשבוע.")}</li>
        <li>{tr(locale, "Male, high: 15 drinks or more per week.", "גברים, צריכה גבוהה: 15 מנות או יותר בשבוע.")}</li>
      </ul>
    </InfoPopoverButton>
  );
}
