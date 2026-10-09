"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { approveSuggestedGroupAction, splitBundleAction } from "@/app/app/tickets/review-actions";
import { NavLink as Link } from "@/components/nav-link";
import { Spinner } from "@/components/spinner";
import { tr, type AppLocale } from "@/lib/locale";
import type { BundleSuggestion } from "@/lib/automation-overview";

/** Fix bundles on screen (docs/design/auto-ticket-handling.md, "Fix bundles"): a bundle is told apart by its LETTER and its own hue, never
 * by colour alone. Tailwind needs whole class names, so the four palettes are spelled out. */
const HUES = [
  { border: "border-teal-600 dark:border-teal-500", head: "bg-teal-50 dark:bg-teal-950/40", badge: "border-teal-600 bg-teal-100 text-teal-800 dark:border-teal-500 dark:bg-teal-950/60 dark:text-teal-300", chip: "border-teal-500 bg-teal-50 dark:bg-teal-950/40" },
  { border: "border-violet-600 dark:border-violet-400", head: "bg-violet-50 dark:bg-violet-950/40", badge: "border-violet-600 bg-violet-100 text-violet-800 dark:border-violet-400 dark:bg-violet-950/60 dark:text-violet-300", chip: "border-violet-500 bg-violet-50 dark:bg-violet-950/40" },
  { border: "border-sky-600 dark:border-sky-400", head: "bg-sky-50 dark:bg-sky-950/40", badge: "border-sky-600 bg-sky-100 text-sky-800 dark:border-sky-400 dark:bg-sky-950/60 dark:text-sky-300", chip: "border-sky-500 bg-sky-50 dark:bg-sky-950/40" },
  { border: "border-rose-600 dark:border-rose-400", head: "bg-rose-50 dark:bg-rose-950/40", badge: "border-rose-600 bg-rose-100 text-rose-800 dark:border-rose-400 dark:bg-rose-950/60 dark:text-rose-300", chip: "border-rose-500 bg-rose-50 dark:bg-rose-950/40" },
];
export const hueOf = (letter: string) => HUES[Math.max(0, (letter.toUpperCase().charCodeAt(0) || 65) - 65) % HUES.length];

export function BundleBadge({ locale, letter }: { locale: AppLocale; letter: string }) {
  return (
    <span
      title={tr(locale, `Bundle ${letter}: these tickets are built, tested and promoted as one fix`, `חבילה ${letter}: הפניות האלה נבנות, נבדקות ועולות כתיקון אחד`)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${hueOf(letter).badge}`}
    >
      {letter} {"·"} {tr(locale, "Bundle", "חבילה")}
    </span>
  );
}

const linkClass = "text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-60";

/** "Split bundle": asks first and says what will happen (it differs before and after the bundle is built). */
export function SplitBundleControl({ locale, bundleId, letter, seqs, built }: { locale: AppLocale; bundleId: string; letter: string; seqs: number[]; built: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const list = seqs.map((seq) => `TCK-${seq}`).join(", ");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${linkClass} text-slate-700 dark:text-slate-300`}>
        {tr(locale, "Split bundle", "פיצול החבילה")}
      </button>
    );
  }
  return (
    <div role="dialog" aria-label={tr(locale, `Split bundle ${letter}`, `פיצול חבילה ${letter}`)} className="w-full rounded-lg border-2 border-rose-500 bg-white p-3 dark:border-rose-400 dark:bg-slate-900">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{tr(locale, `Split bundle ${letter}?`, `לפצל את חבילה ${letter}?`)}</p>
      <ul className="mt-1 list-disc ps-5 text-xs text-slate-700 dark:text-slate-300">
        <li>{tr(locale, `The bundle goes back to separate tickets: ${list}.`, `החבילה חוזרת לפניות נפרדות: ${list}.`)}</li>
        {built ? (
          <>
            <li>{tr(locale, "Its fix is set aside, and its merge on dev is undone. The old work is kept, not deleted.", "התיקון שלה מונח בצד והמיזוג שלה בפיתוח מבוטל. העבודה הישנה נשמרת ולא נמחקת.")}</li>
            <li>{tr(locale, "The tickets are rebuilt one after another (they change the same files): the first tonight, the next after it is promoted.", "הפניות ייבנו מחדש אחת אחרי השנייה (הן משנות את אותם קבצים): הראשונה הלילה, הבאה אחרי שהקודמת תועלה.")}</li>
            <li>{tr(locale, "Cost: each is a separate agent run, so about as many runs as tickets.", "עלות: כל אחת היא ריצת סוכן נפרדת, כך שמספר הריצות כמספר הפניות.")}</li>
          </>
        ) : (
          <li>{tr(locale, "Nothing is built yet, so nothing is lost. They are built one after another, because they change the same files.", "עדיין לא נבנה דבר, ולכן דבר לא אובד. הן ייבנו אחת אחרי השנייה, כי הן משנות את אותם קבצים.")}</li>
        )}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await splitBundleAction(bundleId);
              if (result.error) setMessage(result.error);
              else router.refresh();
            })
          }
          className={`${linkClass} inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400`}
        >
          {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
          {tr(locale, "Yes, split", "כן, לפצל")}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className={`${linkClass} text-slate-600 dark:text-slate-400`}>
          {tr(locale, "Cancel", "ביטול")}
        </button>
      </div>
      {message ? <p role="status" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{message}</p> : null}
    </div>
  );
}

/** The analyst found tickets waiting for approval that change the same files: approve them as one bundle (recommended) or one by one. */
export function BundleSuggestionCards({ locale, suggestions }: { locale: AppLocale; suggestions: BundleSuggestion[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [message, setMessage] = useState<{ key: string; text: string; error: boolean } | null>(null);
  if (suggestions.length === 0) return null;
  function run(key: string, ids: string[], asBundle: boolean) {
    setWhich(`${key}:${asBundle ? "bundle" : "separate"}`);
    startTransition(async () => {
      const result = await approveSuggestedGroupAction(ids, asBundle);
      setMessage({ key, text: result.error ?? result.success ?? "", error: Boolean(result.error) });
      if (!result.error) router.refresh();
      setWhich(null);
    });
  }
  return (
    <div className="mb-4 space-y-3">
      {suggestions.map((group) => {
        const key = group.ids.join("+");
        const list = group.seqs.map((seq) => `TCK-${seq}`).join(", ");
        return (
          <section key={key} aria-label={tr(locale, `Suggested bundle ${list}`, `חבילה מוצעת ${list}`)} className="rounded-xl border-2 border-dashed border-teal-600 bg-white p-3 dark:border-teal-500 dark:bg-slate-950/40">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {tr(locale, `Suggested: build ${list} together as one fix`, `מוצע: לבנות את ${list} יחד כתיקון אחד`)}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              {tr(locale, "They change the same files", "הן משנות את אותם קבצים")}
              {group.files.length > 0 ? <span className="font-mono"> ({group.files.slice(0, 3).map((file) => file.replace(/^apps\/web\/src\//, "")).join(", ")}{group.files.length > 3 ? ", ..." : ""})</span> : null}
              {tr(locale, ". Built separately, the later ones would conflict with the first and wait a night or more.", ". אם ייבנו בנפרד, המאוחרות יתנגשו עם הראשונה ויחכו לילה או יותר.")}
            </p>
            <ul className="mt-2 space-y-1">
              {group.ids.map((id, index) => (
                <li key={id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{group.seqs[index]}</span>
                  <span dir="auto" className="font-semibold text-slate-900 dark:text-slate-100">{group.subjects[index]}</span>
                  <Link href={`/app/tickets/review/${id}?from=automation`} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400">
                    {tr(locale, "Open its proposal and choices", "פתיחת ההצעה והבחירות שלה")}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <button type="button" disabled={pending} onClick={() => run(key, group.ids, true)} className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 dark:bg-teal-600 dark:hover:bg-teal-500">
                {pending && which === `${key}:bundle` ? <Spinner className="h-4 w-4 animate-spin" /> : null}
                {tr(locale, "Approve as one bundle (recommended)", "אישור כחבילה אחת (מומלץ)")}
              </button>
              <button type="button" disabled={pending} onClick={() => run(key, group.ids, false)} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:underline disabled:opacity-60 dark:text-slate-300">
                {pending && which === `${key}:separate` ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
                {tr(locale, "Approve separately", "אישור בנפרד")}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {tr(locale, "As a bundle: one agent, one fix, one test, one approval. Each ticket keeps the analyst's recommended picks. Separately: built one after another (slower, but each is tested on its own).", "כחבילה: סוכן אחד, תיקון אחד, בדיקה אחת, אישור אחד. כל פנייה מקבלת את הבחירות המומלצות של האנליסט. בנפרד: נבנות אחת אחרי השנייה (לאט יותר, אבל כל אחת נבדקת לבד).")}
            </p>
            {message && message.key === key ? (
              <p role="status" className={`mt-1.5 text-xs ${message.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{message.text}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
