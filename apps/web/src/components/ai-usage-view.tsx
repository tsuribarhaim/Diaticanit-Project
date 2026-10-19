"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { getAiPersonAction } from "@/app/app/tickets/ai-usage/actions";
import { Spinner } from "@/components/spinner";
import { aiFeatureLabel, aiPageLabel } from "@/lib/ai/usage-labels";
import type { AiPersonDetail, AiUsageData, Granularity, Period } from "@/lib/ai-usage-report";
import { tr, type AppLocale } from "@/lib/locale";

const card = "rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";
const muted = "text-slate-500 dark:text-slate-400";
const money = (v: number, digits?: number) => `$${v.toFixed(digits ?? (v !== 0 && Math.abs(v) < 0.1 ? 4 : 2))}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const dateOf = (iso: string) => new Date(`${iso}T12:00:00Z`);

function periodLabel(locale: AppLocale, p: Period): string {
  const loc = locale === "he" ? "he-IL" : "en-GB";
  const f = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(dateOf(iso));
  if (p.gran === "day") return f(p.from, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (p.gran === "week") return `${Number(p.from.slice(8))}–${f(p.to, { day: "numeric", month: "short", year: "numeric" })}`;
  if (p.gran === "month") return f(p.from, { month: "long", year: "numeric" });
  return p.from.slice(0, 4);
}

function bucketLabel(locale: AppLocale, gran: Granularity, key: string): string {
  const loc = locale === "he" ? "he-IL" : "en-GB";
  if (gran === "day") return `${key}:00`;
  if (gran === "year") return new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" }).format(dateOf(`${key}-01`));
  if (gran === "week") return new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(dateOf(key));
  return String(Number(key.slice(8)));
}

type SortKey = "name" | "cost" | "calls" | "avgPerCall" | "share";
type PageSortKey = "page" | "cost" | "users" | "avgPerUser" | "avgPerCall";
type Question = "top3" | "page" | "perAction" | "often" | "none" | "admins";

export function AiUsageView({ locale, data }: { locale: AppLocale; data: AiUsageData }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: "cost", d: -1 });
  const [pageSort, setPageSort] = useState<{ k: PageSortKey; d: 1 | -1 }>({ k: "cost", d: -1 });
  const [topN, setTopN] = useState<"3" | "5" | "10" | "all">("all");
  const [answer, setAnswer] = useState<{ title: string; items?: string[] } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);

  const go = (gran: Granularity, date: string, admins = data.includeAdmins) => {
    setAnswer(null);
    startNav(() => router.push(`/app/tickets/ai-usage?gran=${gran}&date=${date}${admins ? "" : "&admins=0"}`));
  };
  const p = data.period;
  const nextFrom = useMemo(() => {
    if (!data.hasNext) return null;
    const d = dateOf(p.to);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [data.hasNext, p.to]);
  const nameOf = (r: { id: string; name: string }) => r.name || L("No signed-in person", "ללא משתמש מחובר");

  const people = useMemo(() => {
    const rows = [...data.people].sort((a, b) => (sort.k === "name" ? a.name.localeCompare(b.name) : a[sort.k] - b[sort.k]) * sort.d);
    return topN === "all" ? rows : rows.slice(0, Number(topN));
  }, [data.people, sort, topN]);
  const pages = useMemo(
    () => [...data.pages].sort((a, b) => (pageSort.k === "page" ? aiPageLabel(locale, a.page).localeCompare(aiPageLabel(locale, b.page)) : a[pageSort.k] - b[pageSort.k]) * pageSort.d),
    [data.pages, pageSort, locale],
  );

  function ask(q: Question) {
    const byCost = [...data.people].sort((a, b) => b.cost - a.cost);
    if (data.current.calls === 0 && q !== "none") return setAnswer({ title: L("No AI use in this period.", "אין שימוש ב-AI בתקופה הזו.") });
    if (q === "top3") {
      setSort({ k: "cost", d: -1 });
      setTopN("3");
      const top = byCost.slice(0, 3);
      return setAnswer({ title: top.length === 1 ? L("The most expensive person:", "המשתמש היקר ביותר:") : L(`Top ${top.length} by cost:`, `${top.length} המשתמשים היקרים ביותר:`), items: top.map((r) => `${nameOf(r)} · ${money(r.cost)} · ${r.calls} ${L("actions", "פעולות")}`) });
    }
    if (q === "page") {
      const top = data.pages[0];
      return setAnswer({ title: L(`${aiPageLabel(locale, top.page)} cost the most: ${money(top.cost)} (${pct(top.share)} of the total).`, `${aiPageLabel(locale, top.page)} עלה הכי הרבה: ${money(top.cost)} (${pct(top.share)} מהסך).`) });
    }
    if (q === "perAction") {
      const enough = data.people.filter((r) => r.calls >= 5);
      const top = [...(enough.length ? enough : data.people)].sort((a, b) => b.avgPerCall - a.avgPerCall)[0];
      return setAnswer({ title: L(`${nameOf(top)} has the highest cost per action: ${money(top.avgPerCall, 4)}.`, `ל${nameOf(top)} העלות הגבוהה ביותר לפעולה: ${money(top.avgPerCall, 4)}.`) });
    }
    if (q === "often") {
      const top = [...data.people].sort((a, b) => b.calls - a.calls)[0];
      return setAnswer({ title: L(`${nameOf(top)} used AI most often: ${top.calls} actions.`, `${nameOf(top)} השתמש/ה ב-AI הכי הרבה: ${top.calls} פעולות.`) });
    }
    if (q === "none") {
      return setAnswer(
        data.activeWithoutAi.length
          ? { title: L("Opened Daffy in this period but used no AI:", "נכנסו לדפי בתקופה הזו אבל לא השתמשו ב-AI:"), items: data.activeWithoutAi }
          : { title: L("Everyone who opened Daffy in this period used AI.", "כל מי שנכנס לדפי בתקופה הזו השתמש ב-AI.") },
      );
    }
    const g = (x: { cost: number; users: number; calls: number }) => `${money(x.cost)} · ${x.users} ${L("people", "משתמשים")} · ${x.calls} ${L("actions", "פעולות")}`;
    return setAnswer({ title: L("Admins and everyone else:", "מנהלים וכל השאר:"), items: [`${L("Admins", "מנהלים")}: ${g(data.admins)}`, `${L("Everyone else", "כל השאר")}: ${g(data.nonAdmins)}`] });
  }

  const chip = (cur: number, before: number, moreIsGood: boolean) => {
    if (!before) return <span className={`mt-1 inline-block rounded-full bg-slate-100 px-2 text-[11.5px] font-bold dark:bg-slate-800 ${muted}`}>{L("no earlier data", "אין נתונים קודמים")}</span>;
    const d = (cur - before) / before;
    const flat = Math.abs(d) < 0.02;
    const good = flat ? null : d > 0 === moreIsGood;
    const tone = good === null ? `bg-slate-100 dark:bg-slate-800 ${muted}` : good ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400";
    return (
      <span className={`mt-1 inline-block rounded-full px-2 text-[11.5px] font-bold ${tone}`} title={L("vs the previous period", "לעומת התקופה הקודמת")}>
        <span dir="ltr">{d > 0 ? "▲" : d < 0 ? "▼" : "•"} {Math.abs(Math.round(d * 100))}%</span>
      </span>
    );
  };
  const tiles: [string, string, React.ReactNode][] = [
    [L("Total AI cost", "עלות AI כוללת"), money(data.current.cost, 2), chip(data.current.cost, data.before.cost, false)],
    [L("People using AI", "משתמשים ב-AI"), String(data.current.users), chip(data.current.users, data.before.users, true)],
    [L("Avg per person", "ממוצע למשתמש"), money(data.current.avgPerUser, 2), chip(data.current.avgPerUser, data.before.avgPerUser, false)],
    [L("AI actions", "פעולות AI"), data.current.calls.toLocaleString(locale === "he" ? "he-IL" : "en-GB"), chip(data.current.calls, data.before.calls, true)],
    [L("Avg per action", "ממוצע לפעולה"), money(data.current.avgPerCall, 4), chip(data.current.avgPerCall, data.before.avgPerCall, false)],
  ];

  const sortHead = <K extends string>(k: K, label: string, s: { k: K; d: 1 | -1 }, set: (v: { k: K; d: 1 | -1 }) => void, end = false) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap border-b border-slate-200 px-2 py-2 text-[11.5px] font-bold uppercase tracking-wide hover:text-slate-900 dark:border-slate-800 dark:hover:text-slate-100 ${muted} ${end ? "text-end" : "text-start"}`}
      aria-sort={s.k === k ? (s.d < 0 ? "descending" : "ascending") : "none"}
      onClick={() => set({ k, d: s.k === k ? ((-s.d) as 1 | -1) : k === "name" || k === "page" ? 1 : -1 })}
    >
      {label} <span className="text-[10px]">{s.k === k ? (s.d < 0 ? "▼" : "▲") : ""}</span>
    </th>
  );
  const td = "whitespace-nowrap border-b border-slate-100 px-2 py-2 dark:border-slate-800/70";
  const share = (v: number) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">{pct(v)}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
        <span className="block h-full rounded bg-teal-600 dark:bg-teal-400" style={{ width: `${Math.max(2, v * 100)}%` }} />
      </span>
    </span>
  );
  const adminBadge = <span className="rounded-md bg-violet-100 px-1.5 text-[10.5px] font-extrabold uppercase text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">{L("Admin", "מנהל")}</span>;

  return (
    <div className={`flex flex-col gap-3 ${navigating ? "opacity-60 transition-opacity" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={L("Period", "תקופה")} className="inline-flex gap-0.5 rounded-full border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            {(["day", "week", "month", "year"] as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={p.gran === g}
                onClick={() => go(g, data.today)}
                className={`rounded-full px-3 py-1 text-sm font-semibold ${p.gran === g ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : muted}`}
              >
                {g === "day" ? L("Day", "יום") : g === "week" ? L("Week", "שבוע") : g === "month" ? L("Month", "חודש") : L("Year", "שנה")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go(p.gran, data.previous.from)} aria-label={L("Previous period", "התקופה הקודמת")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <span aria-hidden="true" className="rtl:rotate-180">‹</span>
            </button>
            <span className="min-w-[10rem] text-center font-bold tabular-nums text-slate-900 dark:text-slate-100">{periodLabel(locale, p)}</span>
            <button type="button" disabled={!nextFrom} onClick={() => nextFrom && go(p.gran, nextFrom)} aria-label={L("Next period", "התקופה הבאה")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">
              <span aria-hidden="true" className="rtl:rotate-180">›</span>
            </button>
            {navigating ? <Spinner className="h-4 w-4 animate-spin" /> : null}
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          <input type="checkbox" checked={data.includeAdmins} onChange={(e) => go(p.gran, p.from, e.target.checked)} className="h-[18px] w-[18px] accent-teal-600" />
          {L("Include admins", "כולל מנהלים")}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([k, v, c]) => (
          <div key={k} className={`${card} min-w-0 py-3`}>
            <div className={`text-xs font-semibold ${muted}`}>{k}</div>
            <div className="text-[22px] font-extrabold tabular-nums text-slate-900 dark:text-slate-100" dir="ltr">{v}</div>
            {c}
          </div>
        ))}
      </div>

      <CostChart locale={locale} data={data} />

      <section className={card}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{L("Ask about AI usage", "שאלות על השימוש ב-AI")}</h2>
          <span className={`text-sm ${muted}`}>{L("For the selected period", "לתקופה שנבחרה")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["top3", L("Top 3 people by cost", "3 המשתמשים היקרים ביותר")],
              ["page", L("Most expensive page", "העמוד היקר ביותר")],
              ["perAction", L("Highest cost per action", "העלות הגבוהה ביותר לפעולה")],
              ["often", L("Who uses AI the most", "מי משתמש הכי הרבה ב-AI")],
              ["none", L("Opened Daffy without AI", "נכנסו לדפי בלי AI")],
              ["admins", L("Admins vs everyone else", "מנהלים מול כל השאר")],
            ] as [Question, string][]
          ).map(([q, label]) => (
            <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:border-teal-600 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-teal-300">
              {label}
            </button>
          ))}
        </div>
        {answer ? (
          <div role="status" className="mt-3 rounded-xl bg-teal-50 px-3 py-2.5 text-sm text-slate-900 dark:bg-teal-950/40 dark:text-slate-100">
            <b dir="auto">{answer.title}</b>
            {answer.items ? (
              <ol className="mt-1 list-decimal ps-5">
                {answer.items.map((item) => (
                  <li key={item} dir="auto">{item}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className={`${card} min-w-0`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{L("Cost per person", "עלות לפי משתמש")}</h2>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              {L("Show", "הצגה")}
              <select value={topN} onChange={(e) => setTopN(e.target.value as typeof topN)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="all">{L("All", "הכול")}</option>
              </select>
            </label>
          </div>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  {sortHead("name", L("Person", "משתמש"), sort, setSort)}
                  {sortHead("cost", L("Cost", "עלות"), sort, setSort, true)}
                  {sortHead("calls", L("Actions", "פעולות"), sort, setSort, true)}
                  {sortHead("avgPerCall", L("Avg / action", "ממוצע לפעולה"), sort, setSort, true)}
                  <th className={`whitespace-nowrap border-b border-slate-200 px-2 py-2 text-start text-[11.5px] font-bold uppercase tracking-wide dark:border-slate-800 ${muted}`}>{L("Top page", "עמוד מוביל")}</th>
                  {sortHead("share", L("Share", "חלק"), sort, setSort, true)}
                </tr>
              </thead>
              <tbody>
                {people.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={`px-2 py-6 text-center ${muted}`}>{L("No AI use in this period.", "אין שימוש ב-AI בתקופה הזו.")}</td>
                  </tr>
                ) : (
                  people.map((r) => (
                    <tr
                      key={r.id}
                      tabIndex={r.id === "-" ? undefined : 0}
                      onClick={() => r.id !== "-" && setPersonId(r.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && r.id !== "-" && (e.preventDefault(), setPersonId(r.id))}
                      className={r.id === "-" ? "" : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"}
                    >
                      <td className={td}>
                        <span className="inline-flex items-center gap-2">
                          <span dir="auto" className="font-semibold text-slate-900 dark:text-slate-100">{nameOf(r)}</span>
                          {r.isAdmin ? adminBadge : null}
                        </span>
                      </td>
                      <td className={`${td} text-end`} dir="ltr">{money(r.cost, 2)}</td>
                      <td className={`${td} text-end`}>{r.calls}</td>
                      <td className={`${td} text-end`} dir="ltr">{money(r.avgPerCall, 4)}</td>
                      <td className={td}>{aiPageLabel(locale, r.topPage)}</td>
                      <td className={`${td} text-end`}>{share(r.share)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${card} min-w-0`}>
          <div className="mb-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{L("Cost per page", "עלות לפי עמוד")}</h2>
            <p className={`text-xs ${muted}`}>{L("Avg / person = the page's cost ÷ the people who used AI on it", "ממוצע למשתמש = עלות העמוד ÷ המשתמשים שהשתמשו בו ב-AI")}</p>
          </div>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  {sortHead("page", L("Page", "עמוד"), pageSort, setPageSort)}
                  {sortHead("cost", L("Cost", "עלות"), pageSort, setPageSort, true)}
                  {sortHead("users", L("People", "משתמשים"), pageSort, setPageSort, true)}
                  {sortHead("avgPerUser", L("Avg / person", "ממוצע למשתמש"), pageSort, setPageSort, true)}
                  {sortHead("avgPerCall", L("Avg / action", "ממוצע לפעולה"), pageSort, setPageSort, true)}
                </tr>
              </thead>
              <tbody>
                {pages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={`px-2 py-6 text-center ${muted}`}>{L("No AI use in this period.", "אין שימוש ב-AI בתקופה הזו.")}</td>
                  </tr>
                ) : (
                  pages.map((r) => (
                    <tr key={r.page ?? "-"}>
                      <td className={`${td} font-semibold text-slate-900 dark:text-slate-100`}>{aiPageLabel(locale, r.page)}</td>
                      <td className={`${td} text-end`} dir="ltr">{money(r.cost, 2)}</td>
                      <td className={`${td} text-end`}>{r.users}</td>
                      <td className={`${td} text-end`} dir="ltr">{money(r.avgPerUser, 2)}</td>
                      <td className={`${td} text-end`} dir="ltr">{money(r.avgPerCall, 4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <p className={`text-xs ${muted}`}>
        {data.firstDay
          ? L(`Counting since ${data.firstDay.split("-").reverse().join("/")}. `, `הספירה מ-${data.firstDay.split("-").reverse().join("/")}. `)
          : L("No AI use recorded yet. ", "עדיין לא נרשם שימוש ב-AI. ")}
        {data.failedCalls ? L(`${data.failedCalls} failed actions are included (they cost little or nothing). `, `${data.failedCalls} פעולות שנכשלו כלולות (העלות שלהן קטנה או אפס). `) : ""}
        {data.unpricedCalls ? L(`${data.unpricedCalls} actions used a model without a price yet and count as $0. `, `${data.unpricedCalls} פעולות השתמשו במודל שעוד אין לו מחיר ונספרות כ-$0. `) : ""}
        {L("To check the totals, compare with the Anthropic console for the same days.", "כדי לבדוק את הסכומים, אפשר להשוות לקונסולת Anthropic לאותם ימים.")}
      </p>

      {personId ? <PersonPanel locale={locale} userId={personId} period={p} onClose={() => setPersonId(null)} /> : null}
    </div>
  );
}

function CostChart({ locale, data }: { locale: AppLocale; data: AiUsageData }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const [hover, setHover] = useState<number | null>(null);
  const bs = data.buckets;
  const W = 760, H = 210, padL = 48, padR = 10, padT = 10, padB = 26;
  const max = Math.max(0.0001, ...bs.map((b) => b.cost));
  const rough = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / bs.length;
  const every = Math.ceil(bs.length / 12);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  const digits = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const h = hover === null ? null : bs[hover];
  return (
    <section className={card}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{L("Cost over time", "עלות לאורך זמן")}</h2>
        <span className={`text-sm ${muted}`}>
          {h ? (
            <span dir="auto">
              <b className="text-slate-900 dark:text-slate-100">{bucketLabel(locale, data.period.gran, h.key)}</b> · <span dir="ltr">{money(h.cost, h.cost && h.cost < 0.1 ? 4 : 2)}</span> · {h.calls} {L("actions", "פעולות")} · {h.users} {L("people", "משתמשים")}
            </span>
          ) : data.period.gran === "day" ? L("per hour", "לפי שעה") : data.period.gran === "year" ? L("per month", "לפי חודש") : L("per day", "לפי יום")}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ direction: "ltr" }} role="img" aria-label={L("Cost over time", "עלות לאורך זמן")} className="block h-[210px] w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => {
          const y = padT + ih - (v / top) * ih;
          return (
            <g key={v}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="1" />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" className="fill-slate-500 dark:fill-slate-400">${v.toFixed(digits)}</text>
            </g>
          );
        })}
        {bs.map((b, i) => {
          const bh = (b.cost / top) * ih;
          const x = padL + i * bw + bw * 0.16, w = bw * 0.68;
          return (
            <g key={b.key}>
              <rect x={x} y={padT + ih - bh} width={w} height={b.cost > 0 ? Math.max(bh, 1.5) : 0} rx={Math.min(3, w / 3)} className={hover === i ? "fill-teal-700 dark:fill-teal-300" : "fill-teal-600 dark:fill-teal-400"} />
              <rect x={padL + i * bw} y={padT} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              {i % every === 0 ? (
                <text x={padL + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" className="fill-slate-500 dark:fill-slate-400">{bucketLabel(locale, data.period.gran, b.key)}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function PersonPanel({ locale, userId, period, onClose }: { locale: AppLocale; userId: string; period: Period; onClose: () => void }) {
  const L = (en: string, he: string) => tr(locale, en, he);
  const [detail, setDetail] = useState<AiPersonDetail | null>(null);
  const [error, setError] = useState(false);
  // Loaded once per person and period; a re-render of the page around the panel never starts it again.
  useEffect(() => {
    let live = true;
    getAiPersonAction(userId, period.gran, period.from)
      .then((r) => {
        if (!live) return;
        if (r.detail) setDetail(r.detail);
        else setError(true);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [userId, period.gran, period.from]);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const loc = locale === "he" ? "he-IL" : "en-GB";
  const inPeriod = detail ? detail.daily.filter((d) => d.day >= period.from && d.day <= period.to) : [];
  const periodCost = detail ? detail.pages.reduce((s, p) => s + p.cost, 0) : 0;
  const periodCalls = detail ? detail.pages.reduce((s, p) => s + p.calls, 0) : 0;
  const maxDay = detail ? Math.max(0.0001, ...detail.daily.map((d) => d.cost)) : 1;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={L("AI use of one person", "שימוש ב-AI של משתמש")} className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[560px] flex-col gap-3 overflow-y-auto border-s border-slate-200 bg-slate-50 p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`text-xs ${muted}`}>{L("AI use", "שימוש ב-AI")} · {periodLabel(locale, period)}</div>
            <h2 className="flex flex-wrap items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-slate-100">
              <span dir="auto">{detail?.name ?? "…"}</span>
              {detail?.isAdmin ? <span className="rounded-md bg-violet-100 px-1.5 text-[10.5px] font-extrabold uppercase text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">{L("Admin", "מנהל")}</span> : null}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label={L("Close", "סגירה")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{L("Could not load this person's AI use. Try again.", "לא ניתן לטעון את השימוש ב-AI של המשתמש. אפשר לנסות שוב.")}</p> : null}
        {!detail && !error ? <Spinner className="h-5 w-5 animate-spin" /> : null}
        {detail ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                [L("Cost", "עלות"), money(periodCost, 2)],
                [L("Actions", "פעולות"), String(periodCalls)],
                [L("Avg / action", "ממוצע לפעולה"), money(periodCalls ? periodCost / periodCalls : 0, 4)],
              ].map(([k, v]) => (
                <div key={k} className={`${card} py-2.5`}>
                  <div className={`text-xs font-semibold ${muted}`}>{k}</div>
                  <div className="text-lg font-extrabold tabular-nums text-slate-900 dark:text-slate-100" dir="ltr">{v}</div>
                </div>
              ))}
            </div>
            <section className={card}>
              <h3 className="mb-1 text-sm font-bold text-slate-900 dark:text-slate-100">{L("Cost per day, last 30 days", "עלות ליום, 30 הימים האחרונים")}</h3>
              <svg viewBox="0 0 520 110" preserveAspectRatio="none" style={{ direction: "ltr" }} role="img" aria-label={L("Cost per day", "עלות ליום")} className="block h-[110px] w-full">
                <line x1="0" x2="520" y1="94" y2="94" className="stroke-slate-100 dark:stroke-slate-800" />
                {detail.daily.map((d, i) => {
                  const bh = (d.cost / maxDay) * 80;
                  const on = inPeriod.some((x) => x.day === d.day);
                  return <rect key={d.day} x={i * (520 / detail.daily.length) + 2} y={94 - bh} width={520 / detail.daily.length - 4} height={d.cost > 0 ? Math.max(bh, 1.5) : 0} rx="2" className={on ? "fill-teal-600 dark:fill-teal-400" : "fill-slate-300 dark:fill-slate-700"}><title>{`${d.day} ${money(d.cost)}`}</title></rect>;
                })}
                <text x="0" y="108" fontSize="11" className="fill-slate-500 dark:fill-slate-400">{new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }).format(dateOf(detail.daily[0].day))}</text>
                <text x="520" y="108" textAnchor="end" fontSize="11" className="fill-slate-500 dark:fill-slate-400">{new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }).format(dateOf(detail.daily[detail.daily.length - 1].day))}</text>
                <text x="520" y="11" textAnchor="end" fontSize="11" className="fill-slate-500 dark:fill-slate-400">max {money(maxDay, 2)}</text>
              </svg>
            </section>
            <section className={card}>
              <h3 className="mb-1 text-sm font-bold text-slate-900 dark:text-slate-100">{L("By page", "לפי עמוד")}</h3>
              <table className="w-full border-collapse text-sm tabular-nums">
                <tbody>
                  {detail.pages.length === 0 ? (
                    <tr><td className={`py-3 ${muted}`}>{L("No AI use in this period.", "אין שימוש ב-AI בתקופה הזו.")}</td></tr>
                  ) : (
                    detail.pages.map((pg) => (
                      <tr key={pg.page ?? "-"}>
                        <td className="border-b border-slate-100 py-1.5 dark:border-slate-800/70">{aiPageLabel(locale, pg.page)}</td>
                        <td className="border-b border-slate-100 py-1.5 text-end dark:border-slate-800/70" dir="ltr">{money(pg.cost, 2)}</td>
                        <td className={`border-b border-slate-100 py-1.5 text-end dark:border-slate-800/70 ${muted}`}>{pg.calls} {L("actions", "פעולות")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </section>
            <section className={card}>
              <h3 className="mb-1 text-sm font-bold text-slate-900 dark:text-slate-100">{L("Latest AI actions", "פעולות AI אחרונות")}</h3>
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full border-collapse text-[12.5px] tabular-nums">
                  <thead>
                    <tr className={muted}>
                      <th className="px-1 py-1 text-start font-semibold">{L("When", "מתי")}</th>
                      <th className="px-1 py-1 text-start font-semibold">{L("What", "מה")}</th>
                      <th className="px-1 py-1 text-end font-semibold">{L("Tokens in / out", "טוקנים נכנס / יוצא")}</th>
                      <th className="px-1 py-1 text-end font-semibold">{L("Cost", "עלות")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.latest.map((e) => (
                      <tr key={e.at + e.feature}>
                        <td className="whitespace-nowrap border-t border-slate-100 px-1 py-1.5 align-top dark:border-slate-800/70">{new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(e.at))}</td>
                        <td className="border-t border-slate-100 px-1 py-1.5 align-top dark:border-slate-800/70">
                          <div className="text-slate-900 dark:text-slate-100">{aiFeatureLabel(locale, e.feature)}{e.status !== "ok" ? <span className="ms-1 rounded-full bg-rose-100 px-1.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">{e.status === "timeout" ? L("timed out", "חרג מהזמן") : L("failed", "נכשל")}</span> : null}</div>
                          <div className={`text-[11.5px] ${muted}`}>{aiPageLabel(locale, e.page)}{e.surface === "floating_chat" ? ` · ${L("floating chat", "צ'אט צף")}` : ""} · {e.model}</div>
                        </td>
                        <td className="whitespace-nowrap border-t border-slate-100 px-1 py-1.5 text-end align-top dark:border-slate-800/70" dir="ltr">{e.tokensIn.toLocaleString()} / {e.tokensOut.toLocaleString()}</td>
                        <td className="whitespace-nowrap border-t border-slate-100 px-1 py-1.5 text-end align-top dark:border-slate-800/70" dir="ltr">{e.cost === null ? "—" : money(e.cost, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </aside>
    </>
  );
}
