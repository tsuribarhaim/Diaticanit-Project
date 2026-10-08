"use client";

import { NavLink as Link } from "@/components/nav-link";
import { useState, type ReactNode } from "react";

import { tr, type AppLocale } from "@/lib/locale";
import type { AutomationOverview, OverviewTicket, StationId, StationSub } from "@/lib/automation-overview";
import { STATION_ORDER } from "@/lib/automation-overview";

/** The Ticket Automation cycle (docs/design/ticket-automation-dashboard.md): seven stations around a ring, a number on
 * each for the tickets waiting there, shields where only a person can move a ticket on, and a panel with the tickets of
 * the selected station. Who acts is shown by shape, tint, corner icon AND label - never by colour alone. */

type Actor = "admin" | "agent" | "sys";

const ACTOR: Record<StationId, Actor> = { marked: "admin", analysis: "agent", approval: "admin", fix: "agent", test: "admin", promote: "admin", release: "sys" };

const ICON: Record<StationId, ReactNode> = {
  marked: <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-8 8a1 1 0 0 1-1.4 0L3 12z M8 8h.01" />,
  analysis: <path d="M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M16 16l5 5" />,
  approval: <path d="M4 12.5l5 5L20 6.5" />,
  fix: <path d="M14.5 6.5a4 4 0 0 0 5 5L10 21a2.1 2.1 0 0 1-3-3L16.5 8.5 M14.5 6.5l3-3 3 3" />,
  test: <path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3 M7.5 15h9" />,
  promote: <path d="M12 3c3.5 2 5.5 5.5 5.5 9.5L14 16h-4l-3.5-3.5C6.5 8.5 8.5 5 12 3z M8.5 17.5L6 21M15.5 17.5L18 21" />,
  release: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18" />,
};

function stationText(id: StationId, locale: AppLocale) {
  switch (id) {
    case "marked":
      return { name: tr(locale, "Marked", "סומנו"), who: tr(locale, "You", "את/ה"), sub: tr(locale, "waiting for the analyst", "ממתינות לאנליסט"), desc: tr(locale, "Tickets you marked for automation. The analyst picks them up at 18:00.", "פניות שסימנת לאוטומציה. האנליסט לוקח אותן ב-18:00.") };
    case "analysis":
      return { name: tr(locale, "Analysis", "ניתוח"), who: tr(locale, "AI analyst", "אנליסט AI"), sub: tr(locale, "writing proposals", "כותב הצעות"), desc: tr(locale, "The analyst is studying these in the real code and writing a proposal for each.", "האנליסט בודק אותן בקוד האמיתי וכותב הצעה לכל אחת.") };
    case "approval":
      return { name: tr(locale, "Approve spec", "אישור אפיון"), who: tr(locale, "You", "את/ה"), sub: tr(locale, "your decision", "ההחלטה שלך"), desc: tr(locale, "Proposals waiting for you: choose the options and approve, ask for a change, or reject.", "הצעות שממתינות לך: לבחור אפשרויות ולאשר, לבקש שינוי או לדחות.") };
    case "fix":
      return { name: tr(locale, "Fix", "תיקון"), who: tr(locale, "AI night run", "ריצת לילה AI"), sub: tr(locale, "building the fixes", "בונה את התיקונים"), desc: tr(locale, "Approved tickets queued for the night run (02:15), and any the night run stopped on with questions for you.", "פניות מאושרות בתור לריצת הלילה (02:15), וכאלה שריצת הלילה נעצרה עליהן עם שאלות אליך.") };
    case "test":
      return { name: tr(locale, "Test on dev", "בדיקה בפיתוח"), who: tr(locale, "You", "את/ה"), sub: tr(locale, "your second approval", "האישור השני שלך"), desc: tr(locale, "Fixes ready on dev. Try them, then approve for production or send back.", "תיקונים מוכנים בפיתוח. יש לנסות ואז לאשר לייצור או להחזיר.") };
    case "promote":
      return { name: tr(locale, "Promote", "העלאה לייצור"), who: tr(locale, "You press", "את/ה לוחץ/ת"), sub: tr(locale, "ship to production", "שחרור לייצור"), desc: tr(locale, "Approved for production. One press ships everything you tick as a single release.", "אושרו לייצור. לחיצה אחת משחררת את כל מה שסימנת כגרסה אחת.") };
    case "release":
      return { name: tr(locale, "Release", "שחרור"), who: tr(locale, "Automation", "אוטומציה"), sub: tr(locale, "deploys, resolves", "מעלה ופותר"), desc: tr(locale, "After your press the automation applies only the fixes you ticked, checks them, deploys, tests the live site and resolves the tickets. No AI is involved.", "אחרי הלחיצה שלך האוטומציה מיישמת רק את התיקונים שסימנת, בודקת, מעלה, בודקת את האתר החי ופותרת את הפניות. ללא AI.") };
  }
}

function subText(sub: StationSub, locale: AppLocale): string {
  switch (sub) {
    case "waiting":
      return tr(locale, "Waiting for the next analyst run", "ממתינה לריצת האנליסט הבאה");
    case "analysing":
      return tr(locale, "The analyst is writing the proposal now", "האנליסט כותב עכשיו את ההצעה");
    case "proposal":
      return tr(locale, "Proposal ready for your decision", "הצעה מוכנה להחלטה שלך");
    case "queued":
      return tr(locale, "Queued for the night run (02:15)", "בתור לריצת הלילה (02:15)");
    case "questions":
      return tr(locale, "The night run stopped: questions for you", "ריצת הלילה נעצרה: שאלות אליך");
    case "branch":
      return tr(locale, "Fix ready on its branch - merge it into dev", "תיקון מוכן בענף - למזג לפיתוח");
    case "merging":
      return tr(locale, "The automation is merging it into dev now", "האוטומציה ממזגת אותו עכשיו לפיתוח");
    case "dev":
      return tr(locale, "On dev - try it, then decide", "בפיתוח - לנסות ואז להחליט");
    case "approved":
      return tr(locale, "Approved for production", "אושר לייצור");
    case "releasing":
      return tr(locale, "The automation is releasing it", "האוטומציה משחררת אותו");
  }
}

const STEP = 360 / STATION_ORDER.length;
const R = 190;
const C = 300;
const TRIM = (15 * Math.PI) / 180;
const rad = (deg: number) => (deg * Math.PI) / 180;

const GATES = [
  { arc: 0, tip: ["You mark it", "את/ה מסמנ/ת"] },
  { arc: 2, tip: ["You approve the proposal", "את/ה מאשר/ת את ההצעה"] },
  { arc: 4, tip: ["You approve it for production", "את/ה מאשר/ת לייצור"] },
  { arc: 5, tip: ["You press Promote", "את/ה לוחץ/ת על העלאה"] },
] as const;

const actorShape: Record<Actor, string> = {
  admin: "rounded-full border-blue-500/60 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  agent: "rounded-[30%] border-teal-500/60 bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
  sys: "rounded-full border-dashed border-slate-500/70 bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
};
const actorBadge: Record<Actor, string> = { admin: "bg-blue-600 rounded-full", agent: "bg-teal-600 rounded-[34%]", sys: "bg-slate-500 rounded-full" };
const actorLabel: Record<Actor, string> = { admin: "text-blue-700 dark:text-blue-300", agent: "text-teal-700 dark:text-teal-300", sys: "text-slate-600 dark:text-slate-300" };

function ActorIcon({ actor }: { actor: Actor }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (actor === "admin")
    return (
      <svg {...common} className="h-[62%] w-[62%]">
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" />
      </svg>
    );
  if (actor === "agent")
    return (
      <svg {...common} className="h-[62%] w-[62%]">
        <rect x="5" y="8" width="14" height="11" rx="3" />
        <path d="M12 8V4.5" />
        <circle cx="9.5" cy="13" r="1" />
        <circle cx="14.5" cy="13" r="1" />
      </svg>
    );
  return (
    <svg {...common} className="h-[62%] w-[62%]">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </svg>
  );
}

function ticketHref(ticket: OverviewTicket): string {
  return ticket.station === "marked" || ticket.station === "analysis" || ticket.sub === "queued" ? `/app/tickets/${ticket.id}` : `/app/tickets/review/${ticket.id}`;
}

export function AutomationCycle({ locale, overview }: { locale: AppLocale; overview: AutomationOverview }) {
  const first = STATION_ORDER.find((id) => ticketsAt(overview, id).some((t) => needsAdmin(t))) ?? "approval";
  const [selected, setSelected] = useState<StationId>(first);

  const nodes = STATION_ORDER.map((id, index) => {
    const angle = rad(-90 + index * STEP);
    const px = ((C + R * Math.cos(angle)) / 600) * 100;
    const py = ((C + R * Math.sin(angle)) / 600) * 100;
    const above = index === 0 || index === 1 || index === STATION_ORDER.length - 1;
    const shiftX = ({ 1: 3, 2: 4, 5: -6, 6: -5 } as Record<number, number>)[index] ?? 0;
    return { id, px, py, labelX: px + shiftX, labelY: py + (above ? -12.3 : 12.3) };
  });

  const selectedText = stationText(selected, locale);
  const list = ticketsAt(overview, selected);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div>
        <div className="relative mx-auto aspect-square w-full max-w-[600px]">
          <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <marker id="ac-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" className="fill-slate-400" />
              </marker>
              <marker id="ac-arrow-done" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" className="fill-teal-500" />
              </marker>
            </defs>
            {STATION_ORDER.map((id, index) => {
              const a0 = rad(-90 + index * STEP) + TRIM;
              const a1 = rad(-90 + (index + 1) * STEP) - TRIM;
              const last = index === STATION_ORDER.length - 1;
              return (
                <path
                  key={id}
                  d={`M${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}`}
                  fill="none"
                  strokeWidth={2.4}
                  strokeDasharray={last ? "3 8" : "7 7"}
                  className={`${last ? "stroke-teal-500" : "stroke-slate-400"} motion-safe:animate-[dash_1.4s_linear_infinite]`}
                  markerEnd={`url(#${last ? "ac-arrow-done" : "ac-arrow"})`}
                />
              );
            })}
          </svg>
          <style>{`@keyframes dash{to{stroke-dashoffset:-14}}`}</style>

          <div className="absolute left-1/2 top-1/2 w-[36%] -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="text-[clamp(34px,7vw,52px)] font-bold leading-none text-slate-900 dark:text-slate-100">{overview.total}</div>
            <div className="mt-0.5 text-[clamp(11px,1.9vw,13px)] text-slate-500 dark:text-slate-400">{tr(locale, "tickets in the cycle", "פניות במחזור")}</div>
            <div
              className={`mt-2 inline-block rounded-full px-3 py-0.5 text-[clamp(11px,1.9vw,13px)] font-bold ${
                overview.needsYou > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" : "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300"
              }`}
            >
              {overview.needsYou > 0 ? tr(locale, `${overview.needsYou} need you`, `${overview.needsYou} ממתינות לך`) : tr(locale, "nothing waiting on you", "שום דבר לא ממתין לך")}
            </div>
          </div>

          {GATES.map((gate) => {
            const angle = rad(-90 + (gate.arc + 0.5) * STEP);
            const label = tr(locale, `Sign-off: ${gate.tip[0]}`, `אישור שלך: ${gate.tip[1]}`);
            return (
              <span
                key={gate.arc}
                title={label}
                role="img"
                aria-label={label}
                className="absolute flex aspect-square w-[4.4%] min-w-[20px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-blue-600 dark:border-slate-950"
                style={{ left: `${((C + R * Math.cos(angle)) / 600) * 100}%`, top: `${((C + R * Math.sin(angle)) / 600) * 100}%` }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[64%] w-[64%]" aria-hidden="true">
                  <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
                  <path d="M9 12l2.2 2.2L15.5 10" />
                </svg>
              </span>
            );
          })}

          {nodes.map((node) => {
            const text = stationText(node.id, locale);
            const actor = ACTOR[node.id];
            const count = overview.counts[node.id];
            const waiting = ticketsAt(overview, node.id).filter(needsAdmin).length;
            return (
              <div key={node.id}>
                <button
                  type="button"
                  onClick={() => setSelected(node.id)}
                  aria-label={tr(locale, `${text.name}: ${count} ticket${count === 1 ? "" : "s"}${waiting ? `, ${waiting} need you` : ""}`, `${text.name}: ${count} פניות${waiting ? `, ${waiting} ממתינות לך` : ""}`)}
                  aria-pressed={selected === node.id}
                  className={`absolute flex aspect-square w-[15.5%] -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 p-0 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-teal-500 ${actorShape[actor]} ${
                    selected === node.id ? "ring-[5px] ring-teal-500/30 !border-teal-500" : ""
                  }`}
                  style={{ left: `${node.px}%`, top: `${node.py}%` }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[44%] w-[44%]" aria-hidden="true">
                    {ICON[node.id]}
                  </svg>
                  <span className={`absolute -bottom-[3%] -start-[5%] flex aspect-square w-[30%] items-center justify-center border-2 border-white dark:border-slate-950 ${actorBadge[actor]}`} aria-hidden="true">
                    <ActorIcon actor={actor} />
                  </span>
                  <span
                    className={`absolute -end-[4%] -top-[4%] flex h-[30px] min-w-[30px] items-center justify-center rounded-full border-2 border-white px-2 text-sm font-bold dark:border-slate-950 ${
                      waiting > 0 ? "bg-amber-500 text-white" : count > 0 ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" : "bg-slate-200/60 font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
                <div className="pointer-events-none absolute w-[22%] -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${node.labelX}%`, top: `${node.labelY}%` }}>
                  <b className="block text-[clamp(11px,2.1vw,14.5px)] text-slate-900 dark:text-slate-100">{text.name}</b>
                  <span className={`block text-[clamp(9.5px,1.7vw,12px)] font-bold ${actorLabel[actor]}`}>{text.who}</span>
                  <span className="block text-[clamp(9.5px,1.7vw,12px)] leading-tight text-slate-500 dark:text-slate-400">{text.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span><span aria-hidden="true" className="me-1 inline-block h-3 w-3 rounded-full border-2 border-blue-500 align-[-1px]" />{tr(locale, "circle + person = you", "עיגול + אדם = את/ה")}</span>
          <span><span aria-hidden="true" className="me-1 inline-block h-3 w-3 rounded-[30%] border-2 border-teal-500 align-[-1px]" />{tr(locale, "rounded square + robot = AI agent", "ריבוע מעוגל + רובוט = סוכן AI")}</span>
          <span><span aria-hidden="true" className="me-1 inline-block h-3 w-3 rounded-full border-2 border-dashed border-slate-500 align-[-1px]" />{tr(locale, "dashed circle + gear = automation (no AI)", "עיגול מקווקו + גלגל שיניים = אוטומציה (ללא AI)")}</span>
          <span><span aria-hidden="true" className="me-1 inline-block h-3 w-3 rounded-full bg-blue-600 align-[-1px]" />{tr(locale, "shield = your sign-off", "מגן = האישור שלך")}</span>
          <span><span aria-hidden="true" className="me-1 inline-block h-3 w-3 rounded-full bg-amber-500 align-[-1px]" />{tr(locale, "number = waiting on you", "מספר = ממתין לך")}</span>
        </div>
      </div>

      <section aria-live="polite" className="min-h-[360px] rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            {selectedText.name} <span className="font-medium text-slate-500 dark:text-slate-400">({list.length})</span>
          </h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ACTOR[selected] === "admin" ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300" : ACTOR[selected] === "agent" ? "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
            {ACTOR[selected] === "admin" ? tr(locale, "You act here", "את/ה פועל/ת כאן") : ACTOR[selected] === "agent" ? tr(locale, "AI agent acts here", "סוכן AI פועל כאן") : tr(locale, "Automation acts here - no AI", "האוטומציה פועלת כאן - ללא AI")}
          </span>
        </div>
        <p className="mb-3 mt-1 text-sm text-slate-600 dark:text-slate-400">{selectedText.desc}</p>
        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Nothing here right now.", "אין כאן כלום כרגע.")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((ticket) => (
              <li key={ticket.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.seq}</span>
                  <b dir="auto" className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ticket.subject}</b>
                  {ticket.ageDays >= 3 ? (
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{tr(locale, `waiting ${ticket.ageDays} days - needs a look`, `ממתינה ${ticket.ageDays} ימים - כדאי לבדוק`)}</span>
                  ) : ticket.ageDays > 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{tr(locale, `${ticket.ageDays} day${ticket.ageDays === 1 ? "" : "s"}`, `${ticket.ageDays} ימים`)}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {ticket.pairing ? <span className="me-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">{tr(locale, "Better done together", "עדיף לעשות יחד")}</span> : null}
                  {ticket.hasMigration ? <span className="me-1.5 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">{tr(locale, "Migration", "מיגרציה")}</span> : null}
                  {subText(ticket.sub, locale)}
                </p>
                {ticket.summary ? <p dir="auto" className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{ticket.summary}</p> : null}
                <div className="mt-2">
                  <Link href={ticketHref(ticket)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    {ticket.station === "marked" || ticket.station === "analysis" || ticket.sub === "queued" ? tr(locale, "Open ticket", "פתיחת הפנייה") : ticket.station === "approval" ? tr(locale, "Open proposal", "פתיחת ההצעה") : tr(locale, "Open review", "פתיחת הסקירה")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ticketsAt(overview: AutomationOverview, station: StationId): OverviewTicket[] {
  return overview.tickets.filter((ticket) => ticket.station === station);
}

/** Waiting on the admin: proposals, questions, fixes to test (not while the automation is merging), fixes to promote. */
function needsAdmin(ticket: OverviewTicket): boolean {
  if (ticket.station === "approval" || ticket.station === "promote") return true;
  if (ticket.station === "test") return ticket.sub !== "merging";
  return ticket.station === "fix" && ticket.sub === "questions";
}
