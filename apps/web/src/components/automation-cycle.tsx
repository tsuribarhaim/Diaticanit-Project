"use client";

import { NavLink as Link } from "@/components/nav-link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  approveForProductionAction,
  approveProposalAction,
  rejectProposalAction,
  requestChangeAction,
  requestAgentRunAction,
  requestMergeAction,
  searchAutomationTicketsAction,
  setAutomationPausedAction,
  sendBackFixAction,
  takeTicketOutAction,
} from "@/app/app/tickets/review-actions";
import { type AutomationSearchHit } from "@/app/app/tickets/review-actions";
import { Spinner } from "@/components/spinner";
import { ActionButton, HandledByHand, PromoteBar } from "@/components/ticket-review-panels";
import { tr, type AppLocale } from "@/lib/locale";
import type { AutomationOverview, AutomationStatus, OverviewTicket, RunInfo, StationId, StationSub } from "@/lib/automation-overview";
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
    case "building":
      return tr(locale, "The night run is building this fix now", "ריצת הלילה בונה את התיקון עכשיו");
    case "stopped":
      return tr(locale, "The night run stopped before it finished - open it to see why", "ריצת הלילה נעצרה לפני שסיימה - לפתוח כדי לראות למה");
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

export function AutomationCycle({ locale, overview }: { locale: AppLocale; overview: AutomationOverview }) {
  const first = STATION_ORDER.find((id) => ticketsAt(overview, id).some((t) => needsAdmin(t))) ?? "approval";
  const [selected, setSelected] = useState<StationId>(first);
  const [legendOpen, setLegendOpen] = useState(false);
  // Search: type a number or words, pick a ticket, and the station it is at lights up and its card opens.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ q: string; hits: AutomationSearchHit[] }>({ q: "", hits: [] });
  // Only results that belong to what is typed NOW (a slow answer to an older query must not show).
  const outside = found.q === query.trim() ? found.hits : [];
  const searchDone = found.q === query.trim();
  const [focus, setFocus] = useState<{ ticket: OverviewTicket | null; hit: AutomationSearchHit | null } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inCycle = query.trim()
    ? overview.tickets.filter((ticket) => {
        const q = query.trim().toLowerCase();
        const digits = q.replace(/\D/g, "");
        return (/^(tck)?[-\s]?\d+$/.test(q) && digits ? String(ticket.seq) === digits || String(ticket.seq).startsWith(digits) : ticket.subject.toLowerCase().includes(q));
      })
    : [];
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      void searchAutomationTicketsAction(q).then((hits) => setFound({ q, hits: hits.filter((hit) => !overview.tickets.some((ticket) => ticket.id === hit.id)) }));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, overview.tickets]);
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);
  const router = useRouter();
  const busy = overview.status.analysisInProgress || overview.status.runInProgress || overview.status.promoteInProgress || overview.status.requested.analyze || overview.status.requested.night || overview.status.requested.digest || overview.counts.release > 0;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(timer);
  }, [busy, router]);
  const focusStation: StationId | null = focus?.ticket ? focus.ticket.station : focus?.hit?.releasedAt ? "release" : null;

  const nodes = STATION_ORDER.map((id, index) => {
    const angle = rad(-90 + index * STEP);
    const px = ((C + R * Math.cos(angle)) / 600) * 100;
    const py = ((C + R * Math.sin(angle)) / 600) * 100;
    const above = index === 0 || index === 1 || index === STATION_ORDER.length - 1;
    const shiftX = ({ 1: 3, 2: 4, 5: -6, 6: -5 } as Record<number, number>)[index] ?? 0;
    return { id, px, py, labelX: px + shiftX, labelY: py + (above ? -12.3 : 12.3) };
  });

  const fixTickets = ticketsAt(overview, "fix");
  const fixQueued = fixTickets.filter((ticket) => ticket.sub === "queued").length;
  const fixStopped = fixTickets.filter((ticket) => ticket.sub === "questions" || ticket.sub === "stopped").length;
  /** The line under a station's name: what it is doing right now, not what it is for. */
  function caption(id: StationId, fallback: string): string {
    if (id === "fix") {
      if (overview.status.runInProgress) return tr(locale, "building the fixes now", "בונה את התיקונים עכשיו");
      const parts = [
        fixQueued > 0 ? tr(locale, `${fixQueued} queued for 02:15`, `${fixQueued} בתור ל-02:15`) : null,
        fixStopped > 0 ? tr(locale, `${fixStopped} stopped`, `${fixStopped} נעצרו`) : null,
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? parts.join(" · ") : tr(locale, "waits for 02:15", "ממתין ל-02:15");
    }
    if (id === "analysis") return overview.status.analysisInProgress ? tr(locale, "writing proposals now", "כותב הצעות עכשיו") : tr(locale, "runs at 18:00", "רץ ב-18:00");
    return fallback;
  }

  const selectedText = stationText(selected, locale);
  const list = ticketsAt(overview, selected);

  return (
    <div className="space-y-4">
      <StatusStrip locale={locale} status={overview.status} />
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div>
        <div ref={boxRef} className="relative mx-auto mb-3 max-w-[600px]">
          <svg className="pointer-events-none absolute start-3.5 top-3 h-[18px] w-[18px] text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l5 5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={tr(locale, "Find a ticket - number or words", "חיפוש פנייה - מספר או מילים")}
            aria-label={tr(locale, "Find a ticket", "חיפוש פנייה")}
            className="w-full rounded-full border border-slate-300 bg-white py-2.5 pe-4 ps-10 text-sm text-slate-900 outline-none ring-teal-600 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {open && query.trim() ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {inCycle.slice(0, 6).map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus({ ticket, hit: null });
                      setSelected(ticket.station);
                      setOpen(false);
                    }}
                    className="flex w-full items-baseline gap-3 border-b border-slate-100 px-4 py-2 text-start text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <span className="font-mono text-xs text-slate-500">TCK-{ticket.seq}</span>
                    <span dir="auto" className="min-w-0 flex-1 truncate">{ticket.subject}</span>
                    <em className="whitespace-nowrap text-xs font-semibold not-italic text-teal-700 dark:text-teal-400">{stationText(ticket.station, locale).name}</em>
                  </button>
                </li>
              ))}
              {outside.slice(0, 6).map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocus({ ticket: null, hit });
                      setOpen(false);
                    }}
                    className="flex w-full items-baseline gap-3 border-b border-slate-100 px-4 py-2 text-start text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <span className="font-mono text-xs text-slate-500">TCK-{hit.seq}</span>
                    <span dir="auto" className="min-w-0 flex-1 truncate">{hit.subject}</span>
                    <em className="whitespace-nowrap text-xs font-semibold not-italic text-slate-500">{hit.releasedAt ? tr(locale, "released", "שוחררה") : tr(locale, "not in automation", "לא באוטומציה")}</em>
                  </button>
                </li>
              ))}
              {inCycle.length === 0 && outside.length === 0 && searchDone ? <li className="px-4 py-3 text-sm text-slate-500">{tr(locale, "No ticket matches.", "לא נמצאה פנייה.")}</li> : null}
            </ul>
          ) : null}
        </div>
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
                  } ${focusStation === node.id ? "!border-amber-500 ring-[6px] ring-amber-500/40 motion-safe:animate-pulse" : ""}`}
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
                  <span className="block text-[clamp(9.5px,1.7vw,12px)] leading-tight text-slate-500 dark:text-slate-400">{caption(node.id, text.sub)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-center sm:hidden">
          <button
            type="button"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100">?</span>
            {tr(locale, "What do the shapes mean?", "מה המשמעות של הצורות?")}
          </button>
        </div>
        <div className={`${legendOpen ? "flex" : "hidden"} mt-2 flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 sm:flex dark:text-slate-400`}>
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
        {focus ? <FoundCard locale={locale} focus={focus} onClear={() => { setFocus(null); setQuery(""); }} /> : null}
        {list.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Nothing here right now.", "אין כאן כלום כרגע.")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((ticket) => (
              <TicketRow key={ticket.id} locale={locale} ticket={ticket} highlighted={focus?.ticket?.id === ticket.id} />
            ))}
          </ul>
        )}
        {selected === "promote" && list.length > 0 ? (
          <div className="mt-4">
            <PromoteBar
              locale={locale}
              approved={list.length}
              running={overview.counts.release > 0}
              tickets={list.filter((ticket) => ticket.proposalId).map((ticket) => ({ seq: ticket.seq, subject: ticket.subject, proposalId: ticket.proposalId as string, migration: ticket.hasMigration }))}
            />
          </div>
        ) : null}
        {selected === "marked" && list.length > 0 ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {tr(locale, "The analyst picks these up at 18:00. To start it now, use the ", "האנליסט לוקח אותן ב-18:00. כדי להפעיל אותו עכשיו, יש להשתמש בתחנת ")}
            <button type="button" onClick={() => setSelected("analysis")} className="font-semibold text-teal-700 underline dark:text-teal-400">{tr(locale, "Analysis station", "הניתוח")}</button>.
          </p>
        ) : null}
        {selected === "analysis" ? <AgentRunBar locale={locale} kind="analyze" tickets={ticketsAt(overview, "marked")} status={overview.status} /> : null}
        {selected === "fix" ? <AgentRunBar locale={locale} kind="night" tickets={ticketsAt(overview, "fix").filter((ticket) => ticket.sub === "queued")} status={overview.status} /> : null}
      </section>
    </div>
    </div>
  );
}

/** A button that looks like a text link (colour keeps its meaning: teal = the main action, rose = take away, grey = the rest). */
function LinkAction({ variant = "secondary", pending, disabled, onClick, children }: { variant?: "primary" | "secondary" | "danger"; pending: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const color = variant === "primary" ? "text-teal-700 dark:text-teal-400" : variant === "danger" ? "text-rose-600 dark:text-rose-400" : "text-slate-700 dark:text-slate-300";
  return (
    <button type="button" onClick={onClick} disabled={pending || disabled} aria-busy={pending} className={`inline-flex items-center gap-1.5 text-sm font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-60 ${color}`}>
      {pending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

const pillBase = "inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs";

function fmtTime(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
}

function runText(run: RunInfo | null, none: string, label: string, locale: AppLocale): string {
  if (!run || !run.finishedAt) return none;
  return `${label} ${fmtTime(run.finishedAt, locale)}${run.result ? ` · ${run.result}` : ""}${run.costUsd !== null ? ` · $${run.costUsd.toFixed(2)}` : ""}`;
}

/** What the laptop is doing, the last runs, and the Pause switch (stops only the two AI agents). */
function StatusStrip({ locale, status }: { locale: AppLocale; status: AutomationStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const running = status.analysisInProgress || status.runInProgress || status.promoteInProgress;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pillBase} ${status.bridgeOnline ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300" : "border-rose-300 bg-rose-50 font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"}`} title={tr(locale, "The program on your laptop that runs the agents. It must be on.", "התוכנה במחשב הנייד שמריצה את הסוכנים. היא חייבת להיות דלוקה.")}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status.bridgeOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
          {status.bridgeOnline
            ? tr(locale, "Bridge online", "הגשר פעיל")
            : tr(locale, `Bridge offline${status.bridgeSeenAt ? ` - last seen ${fmtTime(status.bridgeSeenAt, locale)}` : ""}`, `הגשר כבוי${status.bridgeSeenAt ? ` - נראה לאחרונה ${fmtTime(status.bridgeSeenAt, locale)}` : ""}`)}
        </span>
        {running ? (
          <span className={`${pillBase} border-sky-300 font-semibold text-sky-800 dark:border-sky-800 dark:text-sky-300`}>
            <Spinner className="h-3 w-3 animate-spin" />
            {status.analysisInProgress ? tr(locale, "Analyst running now", "האנליסט רץ עכשיו") : status.runInProgress ? tr(locale, "Night run running now", "ריצת הלילה רצה עכשיו") : tr(locale, "A release is running now", "שחרור רץ עכשיו")}
          </span>
        ) : null}
        <span className={`${pillBase} border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400`}>{runText(status.lastNight, tr(locale, "No night run recorded yet", "טרם נרשמה ריצת לילה"), tr(locale, "Last night run", "ריצת לילה אחרונה"), locale)}</span>
        <span className={`${pillBase} border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400`}>{runText(status.lastAnalyst, tr(locale, "No analyst run recorded yet", "טרם נרשמה ריצת אנליסט"), tr(locale, "Last analyst run", "ריצת אנליסט אחרונה"), locale)}</span>
        <span className={`${pillBase} border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400`}>{tr(locale, "Next: analyst 18:00 · night run 02:15", "הבא: אנליסט 18:00 · ריצת לילה 02:15")}</span>
        {status.bridgeOnline ? <span className={`${pillBase} border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400`}>{tr(locale, `Auto-merge to dev: ${status.autoMerge ? "on" : "off"}`, `מיזוג אוטומטי לפיתוח: ${status.autoMerge ? "פעיל" : "כבוי"}`)}</span> : null}
        <label className="ms-auto inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200" title={tr(locale, "Stops only the analyst and the night run. Your own actions are never blocked.", "עוצר רק את האנליסט ואת ריצת הלילה. הפעולות שלך לא נחסמות.")}>
          {pending ? <Spinner className="h-4 w-4 animate-spin" /> : <input type="checkbox" checked={status.paused} onChange={(event) => startTransition(async () => { const result = await setAutomationPausedAction(event.target.checked); setMessage(result.error ?? result.success ?? null); router.refresh(); })} className="h-[18px] w-[18px] accent-amber-600" />}
          {tr(locale, "Pause the AI agents", "השהיית סוכני ה-AI")}
        </label>
      </div>
      {status.paused ? (
        <p role="status" className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          {tr(locale, "Automation is paused: the analyst and the night run will not start until you resume. Your tickets and sign-offs stay as they are, and you can still approve, merge and promote.", "האוטומציה מושהית: האנליסט וריצת הלילה לא יתחילו עד שתחדש. הפניות והאישורים שלך נשארים, ואפשר עדיין לאשר, למזג ולהעלות.")}
        </p>
      ) : message ? (
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{message}</p>
      ) : null}
    </div>
  );
}

type RunKind = "analyze" | "night" | "digest";

/** Asks for the admin's sign-off before it starts an agent: the press is the authorisation. */
function RunDialog({ locale, kind, tickets, onClose }: { locale: AppLocale; kind: RunKind; tickets: OverviewTicket[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ text: string; error: boolean } | null>(null);
  const title =
    kind === "analyze" ? tr(locale, "Start the analyst now?", "להפעיל את האנליסט עכשיו?") : kind === "night" ? tr(locale, "Start the night run now?", "להפעיל את ריצת הלילה עכשיו?") : tr(locale, "Send the daily digest now?", "לשלוח את הסיכום היומי עכשיו?");
  const text =
    kind === "analyze"
      ? tr(locale, "It reads the real code, writes a proposal for each ticket below and e-mails you a summary. About 10 to 20 minutes; at most $3 per ticket.", "הוא קורא את הקוד האמיתי, כותב הצעה לכל פנייה למטה ושולח לך סיכום במייל. כ-10 עד 20 דקות; עד $3 לפנייה.")
      : kind === "night"
        ? tr(locale, "It builds each approved fix below in a throwaway copy, re-checks it and, when every check passes, merges it into your dev app. About 10 to 30 minutes; the daily cap is $20.", "הוא בונה כל תיקון מאושר למטה בעותק זמני, בודק שוב וכשכל הבדיקות עוברות ממזג אותו לאפליקציית הפיתוח. כ-10 עד 30 דקות; תקרה יומית $20.")
        : tr(locale, "The same e-mail as 07:00, to you and Orit, with today's numbers.", "אותו מייל של 07:00, אליך ואל אורית, עם המספרים של היום.");
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label={tr(locale, "Close", "סגירה")} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{text}</p>
        {tickets.length > 0 ? (
          <ul className="mt-2 list-disc space-y-0.5 ps-5 text-sm text-slate-800 dark:text-slate-200">
            {tickets.map((ticket) => (
              <li key={ticket.id} dir="auto">TCK-{ticket.seq} - {ticket.subject}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2.2 2.2L15.5 10" /></svg>
          {tr(locale, "Pressing the button is your sign-off to start it", "הלחיצה היא האישור שלך להתחיל")}
        </p>
        {result ? <p role="status" className={`mt-2 text-sm ${result.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{result.text}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {result && !result.error ? null : (
            <>
              <ActionButton
                variant="primary"
                pending={pending}
                onClick={() =>
                  startTransition(async () => {
                    const response = await requestAgentRunAction(kind);
                    setResult(response.error ? { text: response.error, error: true } : { text: response.success ?? "", error: false });
                    if (!response.error) router.refresh();
                  })
                }
              >
                {tr(locale, "Yes, start it", "כן, להתחיל")}
              </ActionButton>
              <ActionButton pending={false} disabled={pending} onClick={onClose}>{tr(locale, "Cancel", "ביטול")}</ActionButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The run button of a station, in the same teal bar as Promote. */
function AgentRunBar({ locale, kind, tickets, status }: { locale: AppLocale; kind: "analyze" | "night"; tickets: OverviewTicket[]; status: AutomationStatus }) {
  const [open, setOpen] = useState(false);
  const running = kind === "analyze" ? status.analysisInProgress : status.runInProgress;
  const requested = kind === "analyze" ? status.requested.analyze : status.requested.night;
  const count = tickets.length;
  const reason = status.paused
    ? tr(locale, "Automation is paused - resume it first", "האוטומציה מושהית - יש לחדש אותה קודם")
    : !status.bridgeOnline
      ? tr(locale, "The bridge is offline - your laptop must be on", "הגשר כבוי - המחשב הנייד חייב להיות דלוק")
      : running
        ? tr(locale, "Running now - an e-mail follows when it ends", "רץ עכשיו - מייל יישלח בסיומו")
        : requested
          ? tr(locale, "Requested - it starts within a minute", "התבקש - יתחיל תוך דקה")
          : count === 0
            ? tr(locale, "Nothing is waiting for it", "אין מה לעבד")
            : null;
  const label = kind === "analyze" ? tr(locale, "Run the analyst now", "הפעלת האנליסט עכשיו") : tr(locale, "Run the night run now", "הפעלת ריצת הלילה עכשיו");
  const summary =
    kind === "analyze"
      ? tr(locale, `${count} ticket${count === 1 ? "" : "s"} will be analysed (it runs every day at 18:00)`, `${count} פניות ינותחו (הוא רץ כל יום ב-18:00)`)
      : tr(locale, `${count} approved ticket${count === 1 ? "" : "s"} will be built (it runs every night at 02:15)`, `${count} פניות מאושרות ייבנו (הוא רץ כל לילה ב-02:15)`);
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-teal-700 px-4 py-3 text-white dark:bg-teal-600">
        <span className="text-sm font-semibold">{reason && (running || requested) ? <span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4 animate-spin" />{reason}</span> : (reason && count === 0) || status.paused || !status.bridgeOnline ? reason : summary}</span>
        <button type="button" disabled={reason !== null} onClick={() => setOpen(true)} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60">
          {label}
        </button>
      </div>
      {open ? <RunDialog locale={locale} kind={kind} tickets={tickets} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** "Send the daily digest now" - a link card on the dashboard. */
export function DigestCard({ locale, digestRequested }: { locale: AppLocale; digestRequested: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{tr(locale, "Daily digest", "סיכום יומי")}</span>
          <span className="text-xs font-bold text-teal-700 dark:text-teal-400">07:00</span>
        </span>
        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{tr(locale, "The morning e-mail to you and Orit - or send it now.", "המייל של הבוקר אליך ואל אורית - או לשלוח עכשיו.")}</span>
        <div className="mt-2">
          <LinkAction pending={false} disabled={digestRequested} onClick={() => setOpen(true)}>{digestRequested ? tr(locale, "Requested", "התבקש") : tr(locale, "Send now", "שליחה עכשיו")}</LinkAction>
        </div>
      </div>
      {open ? <RunDialog locale={locale} kind="digest" tickets={[]} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type CommentMode = "change" | "reject" | "sendback";

const linkButton = "text-sm font-semibold text-slate-700 hover:underline dark:text-slate-300";
const linkButtonPrimary = "text-sm font-semibold text-teal-700 hover:underline dark:text-teal-400";

/** One ticket in a station panel: what it is, who signed what off, and the buttons that move it on. Every button reuses the
 * existing review step (lib/ticket-review.ts), so the dashboard and the review screens always agree. */
function TicketRow({ locale, ticket, highlighted = false }: { locale: AppLocale; ticket: OverviewTicket; highlighted?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [mode, setMode] = useState<CommentMode | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function run(name: string, action: () => Promise<{ error?: string; success?: string }>) {
    setWhich(name);
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
      if (!result.error) {
        setMode(null);
        setComment("");
        router.refresh();
      }
      setWhich(null);
    });
  }

  const proposalId = ticket.proposalId;
  const onTicketPage = ticket.station === "marked" || ticket.station === "analysis" || ticket.sub === "queued";
  const openHref = onTicketPage ? `/app/tickets/${ticket.id}?from=automation` : `/app/tickets/review/${ticket.id}?from=automation`;
  const openLabel = onTicketPage
    ? tr(locale, "Open ticket", "פתיחת הפנייה")
    : ticket.station === "approval"
      ? tr(locale, "Open proposal", "פתיחת ההצעה")
      : ticket.sub === "building"
        ? tr(locale, "See what is happening", "לראות מה קורה")
        : ticket.sub === "stopped"
        ? tr(locale, "See why it stopped", "לראות למה נעצרה")
        : ticket.sub === "questions"
          ? tr(locale, "Answer the questions", "מענה לשאלות")
          : tr(locale, "Open fix card", "פתיחת כרטיס התיקון");
  const takeOut = (
    <LinkAction variant="danger" pending={pending && which === "out"} disabled={pending} onClick={() => run("out", () => takeTicketOutAction(ticket.id))}>
      {tr(locale, "Take out of automation", "הוצאה מהאוטומציה")}
    </LinkAction>
  );
  const commentButton = (kind: CommentMode, label: string, variant: "secondary" | "danger" = "secondary") => (
    <LinkAction
      variant={variant}
      pending={false}
      disabled={pending}
      onClick={() => {
        setMode(kind);
        setMessage(null);
      }}
    >
      {label}
    </LinkAction>
  );

  return (
    <li className={`rounded-xl border px-3 py-2.5 ${highlighted ? "border-amber-500 bg-amber-50 ring-2 ring-amber-500/40 dark:bg-amber-950/20" : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40"}`}>
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
      {ticket.issue ? (
        <p dir="auto" role="alert" className="mt-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {"⚠ "}
          {ticket.issue}
        </p>
      ) : null}
      {ticket.summary ? <p dir="auto" className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{ticket.summary}</p> : null}
      <SignoffChips locale={locale} signoffs={ticket.signoffs} />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {ticket.station === "approval" && !ticket.pairing && proposalId ? (
          <>
            <LinkAction variant="primary" pending={pending && which === "approve"} disabled={pending} onClick={() => run("approve", () => approveProposalAction(proposalId, {}, ""))}>
              {tr(locale, "Approve (recommended picks)", "אישור (הבחירות המומלצות)")}
            </LinkAction>
            <Link href={openHref} className={linkButton}>{openLabel}</Link>
            {commentButton("change", tr(locale, "Request change", "בקשת שינוי"))}
            {commentButton("reject", tr(locale, "Reject", "דחייה"), "danger")}
          </>
        ) : null}
        {ticket.station === "approval" && ticket.pairing ? (
          <>
            <Link href={openHref} className={linkButtonPrimary}>{tr(locale, "Open proposal and copy the brief", "פתיחת ההצעה והעתקת התקציר")}</Link>
            <HandledByHand locale={locale} ticketId={ticket.id} />
            {takeOut}
          </>
        ) : null}
        {ticket.station === "test" && ticket.sub === "branch" && proposalId ? (
          <>
            <LinkAction variant="primary" pending={pending && which === "merge"} disabled={pending} onClick={() => run("merge", () => requestMergeAction(proposalId))}>
              {tr(locale, "Merge to dev", "מיזוג לפיתוח")}
            </LinkAction>
            <Link href={openHref} className={linkButton}>{openLabel}</Link>
          </>
        ) : null}
        {ticket.station === "test" && ticket.sub === "dev" && proposalId ? (
          <>
            <LinkAction variant="primary" pending={pending && which === "toprod"} disabled={pending} onClick={() => run("toprod", () => approveForProductionAction(proposalId))}>
              {tr(locale, "Approve for production", "אישור לייצור")}
            </LinkAction>
            <Link href={openHref} className={linkButton}>{openLabel}</Link>
            {commentButton("sendback", tr(locale, "Send back", "החזרה"), "danger")}
          </>
        ) : null}
        {ticket.station === "promote" && proposalId ? (
          <>
            <Link href={openHref} className={linkButton}>{openLabel}</Link>
            {commentButton("sendback", tr(locale, "Send back", "החזרה"), "danger")}
          </>
        ) : null}
        {ticket.station === "marked" || ticket.station === "fix" ? (
          <>
            <Link href={openHref} className={ticket.sub === "questions" || ticket.sub === "stopped" ? linkButtonPrimary : linkButton}>{openLabel}</Link>
            {takeOut}
          </>
        ) : null}
        {ticket.station === "analysis" || ticket.station === "release" || (ticket.station === "test" && ticket.sub === "merging") ? <Link href={openHref} className={linkButton}>{openLabel}</Link> : null}
      </div>
      {mode && proposalId ? (
        <div className="mt-2 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor={`c-${ticket.id}`}>
            {mode === "change"
              ? tr(locale, "What should the analyst change?", "מה האנליסט צריך לשנות?")
              : mode === "reject"
                ? tr(locale, "Why is it rejected? (saved on the ticket)", "למה נדחתה? (נשמר בפנייה)")
                : tr(locale, "What is wrong? The merge on dev is reverted and the ticket goes back to the night run.", "מה לא תקין? המיזוג בפיתוח מבוטל והפנייה חוזרת לריצת הלילה.")}
          </label>
          <textarea
            id={`c-${ticket.id}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            maxLength={2000}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="mt-1.5 flex gap-4">
            <LinkAction
              variant="primary"
              pending={pending && which === "comment"}
              disabled={pending || !comment.trim()}
              onClick={() =>
                run("comment", () =>
                  mode === "change" ? requestChangeAction(proposalId, {}, comment) : mode === "reject" ? rejectProposalAction(proposalId, comment) : sendBackFixAction(proposalId, comment),
                )
              }
            >
              {tr(locale, "Confirm", "אישור")}
            </LinkAction>
            <LinkAction
              pending={false}
              disabled={pending}
              onClick={() => {
                setMode(null);
                setComment("");
              }}
            >
              {tr(locale, "Cancel", "ביטול")}
            </LinkAction>
          </div>
        </div>
      ) : null}
      {message ? (
        <p role="status" className={`mt-1.5 text-xs ${message.error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {message.text}
        </p>
      ) : null}
    </li>
  );
}

function fmtDay(iso: string, locale: AppLocale): string {
  return new Date(iso).toLocaleDateString(locale === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Jerusalem" });
}

/** The proof that a person signed each step off: "You approved the spec - 5 Oct". */
function SignoffChips({ locale, signoffs }: { locale: AppLocale; signoffs: OverviewTicket["signoffs"] }) {
  const chips = [
    signoffs.marked ? tr(locale, `You marked it · ${fmtDay(signoffs.marked, locale)}`, `סימנת · ${fmtDay(signoffs.marked, locale)}`) : null,
    signoffs.spec ? tr(locale, `You approved the spec · ${fmtDay(signoffs.spec, locale)}`, `אישרת את האפיון · ${fmtDay(signoffs.spec, locale)}`) : null,
    signoffs.production ? tr(locale, `You approved for production · ${fmtDay(signoffs.production, locale)}`, `אישרת לייצור · ${fmtDay(signoffs.production, locale)}`) : null,
  ].filter((chip): chip is string => chip !== null);
  if (chips.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
          </svg>
          {chip}
        </span>
      ))}
    </div>
  );
}

/** What the search found, and where it stands: the station, the sign-offs so far, and a way in. */
function FoundCard({ locale, focus, onClear }: { locale: AppLocale; focus: { ticket: OverviewTicket | null; hit: AutomationSearchHit | null }; onClear: () => void }) {
  const ticket = focus.ticket;
  const hit = focus.hit;
  const seq = ticket?.seq ?? hit?.seq ?? 0;
  const subject = ticket?.subject ?? hit?.subject ?? "";
  const id = ticket?.id ?? hit?.id ?? "";
  const where = ticket
    ? tr(locale, `Now at: ${stationText(ticket.station, locale).name} - ${subText(ticket.sub, locale)}`, `כעת ב: ${stationText(ticket.station, locale).name} - ${subText(ticket.sub, locale)}`)
    : hit?.releasedAt
      ? tr(locale, `Done - released on ${fmtDay(hit.releasedAt, locale)} (it left the cycle)`, `הסתיים - שוחררה ב-${fmtDay(hit.releasedAt, locale)} (יצאה מהמחזור)`)
      : hit && ["resolved", "closed", "cancelled", "duplicate"].includes(hit.status)
        ? tr(locale, "Closed - not in the cycle", "סגורה - לא במחזור")
        : tr(locale, "Not in automation", "לא באוטומציה");
  return (
    <div className="mb-3 rounded-xl border border-amber-500 bg-amber-50 p-3 dark:bg-amber-950/20">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
        <span className="me-2 font-mono text-xs font-normal text-slate-500">TCK-{seq}</span>
        <span dir="auto">{subject}</span>
      </p>
      <p className="mt-0.5 text-sm font-bold text-amber-800 dark:text-amber-300">{where}</p>
      {ticket ? <SignoffChips locale={locale} signoffs={ticket.signoffs} /> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Link href={`/app/tickets/${id}?from=automation`} className={linkButton}>{tr(locale, "Open ticket", "פתיחת הפנייה")}</Link>
        <LinkAction pending={false} onClick={onClear}>{tr(locale, "Clear", "ניקוי")}</LinkAction>
      </div>
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
  return ticket.station === "fix" && (ticket.sub === "questions" || ticket.sub === "stopped");
}
