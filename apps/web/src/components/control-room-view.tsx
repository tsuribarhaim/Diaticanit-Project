"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { ticketJourneyAction } from "@/app/app/tickets/control/actions";
import { setWorkOrderJobPulledAction } from "@/app/app/tickets/review-actions";
import { NavLink as Link } from "@/components/nav-link";
import type { Actor, ControlRoom, JourneyStep, Source, Tone, Trigger } from "@/lib/control-room";
import { tr, type AppLocale } from "@/lib/locale";

type View = "queues" | "timeline" | "tonight" | "log";

const TONE: Record<Tone, string> = {
  ai: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  you: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  auto: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  batch: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  plain: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};
const ACTOR_DOT: Record<Actor, string> = {
  ai: "rounded-md bg-teal-600 dark:bg-teal-500",
  you: "rounded-full bg-blue-600 dark:bg-blue-500",
  auto: "rounded-full bg-slate-500 outline-dashed outline-1 outline-offset-1 outline-slate-500",
  user: "rounded-full bg-amber-600 dark:bg-amber-500",
};
const BLOCK: Record<string, string> = {
  schedule: "bg-teal-600 dark:bg-teal-500",
  manual: "bg-blue-600 dark:bg-blue-500",
  batch: "bg-violet-600 dark:bg-violet-500",
  auto: "bg-slate-500",
  skip: "border-[1.5px] border-dashed border-slate-400 bg-transparent",
  wait: "border border-amber-500 bg-amber-200/70 dark:bg-amber-900/50",
};

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}

const panel = "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";
const hm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit" });

export function ControlRoomView({ locale, data, dayOffset, initialView }: { locale: AppLocale; data: ControlRoom; dayOffset: number; initialView: View }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const [view, setView] = useState<View>(initialView);
  const [journeyId, setJourneyId] = useState<string | null>(null);
  const sourceChip = (s: Source) =>
    s === "batch" ? <Chip tone="batch">{L("Daily batch", "חבילה יומית")}</Chip> : s === "you" ? <Chip tone="you">{L("Marked by you", "סימנת ידנית")}</Chip> : s === "reopen" ? <Chip tone="amber">{L("Reopened", "נפתחה מחדש")}</Chip> : <Chip tone="auto">{L("Scan candidate", "מועמדת לסריקה")}</Chip>;
  const Tck = ({ id, seq }: { id?: string; seq: number }) =>
    id ? (
      <button type="button" onClick={() => setJourneyId(id)} dir="ltr" className="whitespace-nowrap rounded bg-slate-100 px-1.5 font-mono text-xs text-slate-800 hover:bg-teal-100 hover:text-teal-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-teal-950">
        TCK-{seq}
      </button>
    ) : (
      <span dir="ltr" className="whitespace-nowrap rounded bg-slate-100 px-1.5 font-mono text-xs dark:bg-slate-800">TCK-{seq}</span>
    );

  useEffect(() => {
    // The chosen view travels in the address, so a refresh (or a link) keeps it.
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    window.history.replaceState(null, "", url.toString());
  }, [view]);

  const views: { key: View; label: string }[] = [
    { key: "queues", label: L("Queues", "תורים") },
    { key: "timeline", label: L("Timeline", "ציר זמן") },
    { key: "tonight", label: L("Tonight's plan", "תוכנית הלילה") },
    { key: "log", label: L("Activity log", "יומן פעילות") },
  ];

  return (
    <>
      {/* Now */}
      <section className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]" aria-label={L("Now", "עכשיו")}>
        <div className={panel}>
          <h2 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{L("Running now", "רץ עכשיו")}</h2>
          {data.now.running ? (
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-teal-500 motion-reduce:animate-none" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">{data.now.running.label}{data.now.running.detail ? ` · ${data.now.running.detail}` : ""}</p>
                {data.now.running.progress !== null ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round(data.now.running.progress * 100)}%` }} /></div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">{L("No agent is running.", "אף סוכן לא רץ כרגע.")}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">{data.now.locks.map((l) => <Chip key={l.text} tone={l.tone}>{l.text}</Chip>)}</div>
        </div>
        <div className={panel}>
          <h2 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{L("Next", "הבא בתור")}</h2>
          <ul className="divide-y divide-dashed divide-slate-200 text-sm dark:divide-slate-800">
            {data.now.next.map((n) => (
              <li key={n.what} className="flex items-center justify-between gap-2 py-1">
                <span className="flex flex-wrap items-center gap-1.5 text-slate-800 dark:text-slate-200">{n.what} <Chip tone={n.tone}>{n.why}</Chip></span>
                <span dir="ltr" className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">{n.when}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`${panel} border-blue-300 dark:border-blue-900`}>
          <h2 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">{L("Waiting for you", "ממתין לך")}</h2>
          <ul className="divide-y divide-dashed divide-slate-200 text-sm dark:divide-slate-800">
            {data.now.waiting.map((w) => (
              <li key={w.text} className="flex justify-between gap-2 py-1 text-slate-800 dark:text-slate-200"><span>{w.text}</span><b className="tabular-nums">{w.count || "—"}</b></li>
            ))}
          </ul>
          <Link href="/app/tickets/review" className="mt-2 inline-block text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">{L("Open Review & approvals", "לסקירה ואישורים")}</Link>
        </div>
      </section>

      <div role="tablist" aria-label={L("View", "תצוגה")} className="flex flex-wrap gap-1.5">
        {views.map((v) => (
          <button key={v.key} role="tab" type="button" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={`rounded-full border px-4 py-1.5 text-sm font-bold ${view === v.key ? "border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600" : "border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"}`}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "queues" ? (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.lanes.map((lane) => (
            <div key={lane.key} className={`${panel} ${lane.who.actor === "you" ? "border-blue-300 dark:border-blue-900" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">{lane.title}</h3>
                <span className={`text-xs font-bold ${lane.who.actor === "ai" ? "text-teal-700 dark:text-teal-400" : lane.who.actor === "you" ? "text-blue-700 dark:text-blue-400" : "text-slate-500"}`}>{lane.who.text}</span>
              </div>
              <p className="mb-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">{lane.sub}</p>
              <ul className="grid gap-1.5">
                {lane.items.map((it) => (
                  <li key={it.ticketId} className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
                    <div className="flex items-baseline gap-2"><Tck id={it.ticketId} seq={it.seq} /><span dir="auto" className="min-w-0 text-sm font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{it.subject}</span></div>
                    <div className="mt-1 flex flex-wrap gap-1">{sourceChip(it.source)}{it.chip ? <Chip tone={it.chip.tone}>{it.chip.text}</Chip> : null}</div>
                  </li>
                ))}
                {lane.requests?.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2 text-sm dark:bg-slate-800/60">
                    <Chip tone="auto">{r.what}</Chip>{r.seq ? <Tck seq={r.seq} /> : null}<Chip tone={r.state.tone}>{r.state.text}</Chip>
                  </li>
                ))}
                {lane.items.length === 0 && !lane.requests?.length ? <li className="py-1 text-sm text-slate-500 dark:text-slate-400">{lane.empty}</li> : null}
              </ul>
              {lane.more ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{lane.more}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {view === "timeline" ? <Timeline locale={locale} data={data.timeline} dayOffset={dayOffset} /> : null}
      {view === "tonight" ? <Tonight locale={locale} data={data} Tck={Tck} sourceChip={sourceChip} /> : null}
      {view === "log" ? <Log locale={locale} entries={data.log} Tck={Tck} /> : null}

      {journeyId ? <Journey locale={locale} ticketId={journeyId} onClose={() => setJourneyId(null)} /> : null}
    </>
  );
}

function Timeline({ locale, data, dayOffset }: { locale: AppLocale; data: ControlRoom["timeline"]; dayOffset: number }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const router = useRouter();
  const [picked, setPicked] = useState<number | null>(data.blocks.length ? data.blocks.length - 1 : null);
  const pct = (h: number) => `${Math.min(100, Math.max(0, (h / 24) * 100))}%`;
  const label = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const block = picked !== null ? data.blocks[picked] : null;
  return (
    <section className="grid gap-3">
      <div className={panel}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm text-slate-900 dark:text-slate-100">{L("Automation day", "יום אוטומציה")}: <span dir="ltr">{label(data.from)} → {label(data.to)}</span></b>
          <div className="inline-flex overflow-hidden rounded-full border border-slate-200 text-sm dark:border-slate-800" role="group">
            {[0, 1].map((d) => (
              <button key={d} type="button" onClick={() => router.push(`/app/tickets/control?view=timeline${d ? "&day=1" : ""}`)} className={`px-3 py-1 ${dayOffset === d ? "bg-slate-100 font-bold text-slate-900 dark:bg-slate-800 dark:text-slate-100" : "text-slate-600 dark:text-slate-400"}`}>
                {d ? L("Yesterday", "אתמול") : L("Today", "היום")}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div dir="ltr" className="min-w-[760px]">
            <div className="grid grid-cols-[120px_1fr] text-[10.5px] text-slate-500">
              <span />
              <div className="relative h-4">{Array.from({ length: 12 }, (_, i) => i * 2).map((h) => <span key={h} className="absolute -translate-x-1/2 font-mono" style={{ left: pct(h) }}>{String((16 + h) % 24).padStart(2, "0")}:00</span>)}</div>
            </div>
            {data.rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[120px_1fr] items-center border-b border-slate-200 dark:border-slate-800">
                <div dir="auto" className="px-2 text-end text-xs font-semibold text-slate-800 dark:text-slate-200">{row.title}{row.kind ? <small className="block font-normal text-slate-500">{row.kind}</small> : null}</div>
                <div className="relative h-12 bg-[repeating-linear-gradient(90deg,transparent_0_calc(100%/24-1px),rgb(148_163_184/0.25)_calc(100%/24-1px)_calc(100%/24))]">
                  {data.blocks.map((b, i) =>
                    b.row === row.key ? (
                      <span key={i}>
                        <button type="button" aria-label={`${b.title} ${b.who}`} onClick={() => setPicked(i)} className={`absolute top-1.5 h-[18px] min-w-[10px] rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 dark:focus-visible:outline-white ${BLOCK[b.trigger]} ${picked === i ? "ring-2 ring-slate-900 ring-offset-1 dark:ring-white" : ""}`} style={{ left: pct(b.startH), width: pct(b.lengthH) }} />
                        {b.label ? <span dir="auto" className="pointer-events-none absolute top-[27px] -translate-x-1/2 whitespace-nowrap text-[10.5px] font-semibold text-slate-500" style={{ left: pct(b.startH + b.lengthH / 2) }}>{b.label}</span> : null}
                      </span>
                    ) : null,
                  )}
                  {data.nowH !== null ? <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: pct(data.nowH) }} /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
          {(
            [
              ["schedule", L("By schedule", "לפי לוח זמנים")],
              ["manual", L("Started by you", "הפעלת ידנית")],
              ["batch", L("For the batch", "עבור החבילה")],
              ["auto", L("Automation (no AI)", "אוטומציה (בלי AI)")],
              ["skip", L("Skipped", "דילג")],
              ["wait", L("Waited for another agent", "המתין לסוכן אחר")],
            ] as [Trigger | "skip" | "wait", string][]
          ).map(([k, text]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><i className={`inline-block h-2.5 w-3.5 rounded-sm ${BLOCK[k]}`} />{text}</span>
          ))}
        </div>
      </div>
      <div className={panel}>
        {block ? (
          <>
            <h3 className="mb-2 font-bold text-slate-900 dark:text-slate-100">{block.title}</h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">{L("Started by", "מי הפעיל")}</dt><dd className="min-w-0 text-slate-800 dark:text-slate-200">{block.who}</dd>
              <dt className="text-slate-500">{L("What happened", "מה קרה")}</dt><dd dir="auto" className="min-w-0 text-slate-800 dark:text-slate-200">{block.result || "—"}</dd>
              <dt className="text-slate-500">{L("Cost", "עלות")}</dt><dd className="font-mono text-slate-800 dark:text-slate-200">{block.cost}</dd>
            </dl>
          </>
        ) : (
          <p className="text-sm text-slate-500">{L("Nothing ran in this automation day. Click a run to see its details.", "שום דבר לא רץ ביום הזה. לחיצה על ריצה מציגה את הפרטים שלה.")}</p>
        )}
      </div>
    </section>
  );
}

function Tonight({ locale, data, Tck, sourceChip }: { locale: AppLocale; data: ControlRoom; Tck: (p: { id?: string; seq: number }) => React.ReactElement; sourceChip: (s: Source) => React.ReactElement }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const t = data.tonight;
  if (!t) return <p className={`${panel} text-sm text-slate-600 dark:text-slate-400`}>{L("No plan yet. The planner builds tonight's plan right after the analyst (18:00) and again when the night run starts.", "אין עדיין תוכנית. המתכנן בונה את תוכנית הלילה מיד אחרי האנליסט (18:00) ושוב כשריצת הלילה מתחילה.")}</p>;
  const night = new Date(`${t.nightDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
  const planned = t.jobs.filter((j) => !j.pulled);
  const fill = t.budgetUsd ? Math.min(100, ((t.estimateUsd ?? 0) / t.budgetUsd) * 100) : 0;
  const statusText = t.status === "planned" ? L("Planned - starts at 02:15", "מתוכננת - מתחילה ב-02:15") : t.status === "running" ? L("Running now", "רצה עכשיו") : L("Done", "הסתיימה");
  const toggle = (position: number, pulled: boolean) =>
    start(async () => {
      const result = await setWorkOrderJobPulledAction(t.id, position, pulled);
      setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
      if (!result.error) router.refresh();
    });
  const hist = data.history;
  return (
    <section className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={panel}><b className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{L(`${planned.length} jobs`, `${planned.length} משימות`)}</b><span className="text-xs text-slate-500">{L(`${planned.reduce((s, j) => s + j.seqs.length, 0)} tickets · night of ${night}`, `${planned.reduce((s, j) => s + j.seqs.length, 0)} פניות · הלילה של ${night}`)}</span></div>
        <div className={panel}>
          <b dir="ltr" className="block text-end text-xl font-extrabold tabular-nums text-slate-900 rtl:text-start dark:text-slate-100">${(t.estimateUsd ?? 0).toFixed(2)}</b>
          <span className="text-xs text-slate-500">{L(`estimated, of a $${t.budgetUsd ?? "?"} budget (plans to 80%)`, `הערכה מתוך תקציב של $${t.budgetUsd ?? "?"} (מתכנן עד 80%)`)}</span>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-teal-500" style={{ width: `${fill}%` }} /></div>
        </div>
        <div className={panel}><b className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{t.status === "done" && t.successRate !== null ? `${Math.round(t.successRate * 100)}%` : t.successEstimate !== null ? `${Math.round(t.successEstimate * 100)}%` : "—"}</b><span className="text-xs text-slate-500">{t.status === "done" ? L("succeeded (merged to dev)", "הצליחו (מוזגו לפיתוח)") : L("estimated success", "סיכוי הצלחה משוער")}</span></div>
        <div className={panel}><b className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{L(`${t.deferred.length} wait`, `${t.deferred.length} ממתינות`)}</b><span className="text-xs text-slate-500">{statusText}</span></div>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className={panel}>
          <h3 className="mb-2 text-xs font-bold text-slate-500 dark:text-slate-400">
            {L("Work order", "פקודת העבודה")} · {L(`planned ${hm(t.createdAt)}`, `נבנתה ${hm(t.createdAt)}`)} · {t.plannedBy === "night" ? L("at the night run's start", "בתחילת ריצת הלילה") : L("after the analyst", "אחרי האנליסט")}
            {t.baseRef ? <> · {L("production", "ייצור")} <span dir="ltr" className="font-mono">{t.baseRef}</span></> : null}
          </h3>
          {message ? <p role="status" className={`mb-2 text-sm ${message.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{message.text}</p> : null}
          <ol className="grid gap-2">
            {t.jobs.map((j) => (
              <li key={j.position} className={`grid grid-cols-[30px_1fr_auto] items-start gap-2.5 rounded-xl border border-slate-200 p-3 dark:border-slate-800 ${j.pulled ? "opacity-50" : ""}`}>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-sm font-extrabold tabular-nums dark:bg-slate-800">{j.position}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-1.5">{j.seqs.map((s, i) => <Tck key={s} id={j.ticketIds[i]} seq={s} />)}<span dir="auto" className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{j.subjects.join(" + ")}</span></div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {j.inBatch ? sourceChip("batch") : null}
                    {j.bundleLetter ? <Chip tone="batch">{L(`Bundle ${j.bundleLetter}`, `חבילה ${j.bundleLetter}`)}</Chip> : null}
                    <Chip tone={j.risk === 0 ? "green" : j.risk >= 2 ? "amber" : "plain"}>{j.risk === 0 ? L("Low risk", "סיכון נמוך") : j.risk >= 2 ? L("Higher risk", "סיכון גבוה יותר") : L("Some risk", "סיכון בינוני")}</Chip>
                    <span dir="ltr" className="font-mono text-xs text-slate-500">${j.estimateUsd.toFixed(2)}</span>
                    {j.migrationNumber ? <Chip tone="amber">{L(`Migration ${j.migrationNumber} reserved`, `מיגרציה ${j.migrationNumber} שמורה`)}</Chip> : null}
                    {j.pulled ? <Chip tone="rose">{L("Pulled out", "הוצאה מהלילה")}</Chip> : j.state ? <Chip tone={j.state.tone}>{j.state.text}</Chip> : null}
                  </div>
                  {j.files.length ? <p dir="ltr" className="mt-1 text-end font-mono text-[11px] text-slate-500 [overflow-wrap:anywhere] rtl:text-start">{j.files.map((f) => f.replace(/^apps\/web\/src\//, "")).join(" · ")}</p> : null}
                </div>
                {t.status === "planned" ? (
                  <button type="button" disabled={pending} onClick={() => toggle(j.position, !j.pulled)} className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300">
                    {j.pulled ? L("Put back", "החזרה ללילה") : L("Pull out", "הוצאה מהלילה")}
                  </button>
                ) : <span />}
              </li>
            ))}
            {t.jobs.length === 0 ? <li className="text-sm text-slate-500">{L("Nothing to build tonight.", "אין מה לבנות הלילה.")}</li> : null}
          </ol>
          <p className="mt-2 text-xs text-slate-500">{L("A job you pull out stays queued; the planner considers it again tomorrow.", "משימה שהוצאת נשארת בתור, והמתכנן ישקול אותה שוב מחר.")}</p>
        </div>
        <div className="grid gap-3">
          <div className={panel}>
            <h3 className="mb-1 text-xs font-bold text-slate-500 dark:text-slate-400">{L("Waiting, with the reason", "ממתינות, עם הסיבה")}</h3>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {t.deferred.map((d) => (
                <li key={d.ticketId} className="py-2 text-sm"><div className="flex items-baseline gap-1.5"><Tck id={d.ticketId} seq={d.seq} /><span dir="auto" className="font-semibold text-slate-900 dark:text-slate-100">{d.subject}</span></div><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{d.why}</p></li>
              ))}
              {t.deferred.length === 0 ? <li className="py-2 text-sm text-slate-500">{L("Nothing waits.", "שום דבר לא ממתין.")}</li> : null}
            </ul>
          </div>
          <div className={panel}>
            <h3 className="mb-1 text-xs font-bold text-slate-500 dark:text-slate-400">{L("Success in the last nights · target 90%", "הצלחה בלילות האחרונים · יעד 90%")}</h3>
            {hist.length >= 2 ? (
              <svg viewBox="0 0 300 90" className="h-24 w-full" role="img" aria-label={hist.map((h) => `${h.nightDate}: ${Math.round(h.rate * 100)}%`).join(", ")}>
                <line x1="0" x2="300" y1={8 + 0.1 * 70} y2={8 + 0.1 * 70} className="stroke-amber-500" strokeDasharray="4 4" />
                <polyline fill="none" className="stroke-teal-500" strokeWidth="2" points={hist.map((h, i) => `${10 + (i * 280) / (hist.length - 1)},${8 + (1 - h.rate) * 70}`).join(" ")} />
                {hist.map((h, i) => <circle key={h.nightDate} cx={10 + (i * 280) / (hist.length - 1)} cy={8 + (1 - h.rate) * 70} r="3" className="fill-teal-500" />)}
              </svg>
            ) : (
              <p className="text-sm text-slate-500">{L("Shown once two nights have run by a plan.", "יוצג אחרי שני לילות שרצו לפי תוכנית.")}</p>
            )}
            <p className="text-xs text-slate-500">{L("Success = a planned job built and merged to dev without questions.", "הצלחה = משימה מתוכננת שנבנתה ומוזגה לפיתוח בלי שאלות.")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Log({ locale, entries, Tck }: { locale: AppLocale; entries: ControlRoom["log"]; Tck: (p: { id?: string; seq: number }) => React.ReactElement }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const [filter, setFilter] = useState<"all" | Actor | "batch">("all");
  const [q, setQ] = useState("");
  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (filter === "batch" && !e.tags.includes("batch")) return false;
        if (filter !== "all" && filter !== "batch" && e.actor !== filter) return false;
        const needle = q.trim().toLowerCase().replace(/^tck-/, "");
        if (needle && !(`${e.seq ?? ""} ${e.subject ?? ""} ${e.text} ${e.who}`.toLowerCase().includes(needle))) return false;
        return true;
      }),
    [entries, filter, q],
  );
  const tag = (t: Trigger) => (t === "manual" ? <Chip key={t} tone="you">{L("Manual", "ידני")}</Chip> : t === "batch" ? <Chip key={t} tone="batch">{L("Batch", "חבילה")}</Chip> : t === "auto" ? <Chip key={t} tone="auto">{L("Automatic", "אוטומטי")}</Chip> : <Chip key={t} tone="ai">{L("Schedule", "לוח זמנים")}</Chip>);
  const today = dayKey(new Date().toISOString());
  return (
    <section className={panel}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["all", L("All", "הכל")],
            ["ai", L("AI agents", "סוכני AI")],
            ["auto", L("Automation", "אוטומציה")],
            ["you", L("You", "את/ה")],
            ["user", L("Reporters", "מדווחים")],
            ["batch", L("Batch only", "רק החבילה")],
          ] as ["all" | Actor | "batch", string][]
        ).map(([k, text]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${filter === k ? "border-slate-400 bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100" : "border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-400"}`}>{text}</button>
        ))}
        <label htmlFor="cr-search" className="sr-only">{L("Search a ticket", "חיפוש פנייה")}</label>
        <input id="cr-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search: ticket number or word", "חיפוש: מספר פנייה או מילה")} className="min-w-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-800 dark:bg-slate-950" />
      </div>
      <ul>
        {shown.map((e, i) => {
          const d = dayKey(e.at);
          const header = i === 0 || dayKey(shown[i - 1].at) !== d ? <li key={`d${d}`} className="pb-1 pt-3 text-xs font-extrabold text-slate-500">{d === today ? L(`Today · ${d}`, `היום · ${d}`) : d}</li> : null;
          return [
            header,
            <li key={i} className="grid grid-cols-[46px_22px_1fr_auto] items-start gap-2 border-b border-slate-100 py-2 dark:border-slate-800">
              <span dir="ltr" className="font-mono text-xs tabular-nums text-slate-500">{hm(e.at)}</span>
              <span className={`mt-0.5 h-4 w-4 ${ACTOR_DOT[e.actor]}`} aria-hidden="true" />
              <div className="min-w-0 text-sm text-slate-800 dark:text-slate-200">
                <b>{e.who}</b> <span dir="auto">{e.text}</span> {e.seq ? <><Tck id={e.ticketId} seq={e.seq} /> <span dir="auto">{e.subject}</span></> : null}
                {e.tags.length ? <div className="mt-1 flex flex-wrap gap-1">{e.tags.map(tag)}</div> : null}
              </div>
              <span dir="ltr" className="font-mono text-xs text-slate-500">{e.cost ?? ""}</span>
            </li>,
          ];
        })}
        {shown.length === 0 ? <li className="py-3 text-sm text-slate-500">{L("No activity matches.", "אין פעילות שמתאימה לסינון.")}</li> : null}
      </ul>
    </section>
  );
}

function Journey({ locale, ticketId, onClose }: { locale: AppLocale; ticketId: string; onClose: () => void }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const [data, setData] = useState<{ seq: number; subject: string; steps: JourneyStep[] } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    ticketJourneyAction(ticketId).then((d) => live && setData(d));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [ticketId, onClose]);
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label={L("Close", "סגירה")} className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={L("Ticket journey", "מסלול הפנייה")} className="absolute inset-y-0 end-0 w-full max-w-md overflow-y-auto border-s border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {data ? <span dir="ltr" className="rounded bg-slate-100 px-1.5 font-mono text-xs dark:bg-slate-800">TCK-{data.seq}</span> : null}
            <h2 dir="auto" className="mt-1.5 text-lg font-bold text-slate-900 dark:text-slate-100">{data ? data.subject : data === null ? L("Not found", "לא נמצאה") : L("Loading…", "טוען…")}</h2>
          </div>
          <button type="button" autoFocus onClick={onClose} aria-label={L("Close", "סגירה")} className="text-2xl leading-none text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">×</button>
        </div>
        {data ? (
          <>
            <ol className="relative mt-4 before:absolute before:inset-y-2 before:start-[9px] before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
              {data.steps.map((s, i) => (
                <li key={i} className="relative grid grid-cols-[20px_1fr] gap-3 pb-4">
                  <span className={`relative z-10 mt-0.5 h-5 w-5 ${ACTOR_DOT[s.actor]}`} aria-hidden="true" />
                  <div className="min-w-0 text-sm text-slate-800 dark:text-slate-200"><b>{s.who}</b> <span dir="auto">{s.text}</span><div dir="ltr" className="text-end text-xs text-slate-500 rtl:text-start">{new Date(s.at).toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</div></div>
                </li>
              ))}
            </ol>
            <Link href={`/app/tickets/${ticketId}?from=control`} className="text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400">{L("Open the ticket", "פתיחת הפנייה")}</Link>
          </>
        ) : null}
      </aside>
    </div>
  );
}
