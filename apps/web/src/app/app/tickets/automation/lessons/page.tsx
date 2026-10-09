import { redirect } from "next/navigation";

import { TicketTrail } from "@/components/ticket-trail";
import { NAV_HREF, navLabel } from "@/lib/tickets-nav";
import { LessonToggle, ReviewNav } from "@/components/ticket-review-panels";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

function formatWhen(iso: string | null, locale: AppLocale): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(locale === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** What the agents have learned from the admin's corrections (admin only). Reached from the Ticket Automation dashboard. */
export default async function LessonsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const { data: lessonRows } = await supabase
    .from("automation_lessons")
    .select("id, agent, lesson, source_ticket_seq, source_kind, active, created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  const lessons = (lessonRows ?? []) as { id: string; agent: string; lesson: string; source_ticket_seq: number | null; source_kind: string | null; active: boolean; created_at: string }[];
  const agentLabel = (agent: string) => (agent === "analyst" ? tr(locale, "Analyst", "האנליסט") : agent === "night" ? tr(locale, "Night run", "ריצת הלילה") : tr(locale, "Both agents", "שני הסוכנים"));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
      <TicketTrail locale={locale} items={[{ label: navLabel(locale, "automation"), href: NAV_HREF.automation }, { label: tr(locale, "Lessons", "לקחים") }]} />
      <ReviewNav locale={locale} backLabel={navLabel(locale, "automation")} backHref={NAV_HREF.automation} />
      <h1 className="mb-5 text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "What the agents have learned", "מה שהסוכנים למדו")}</h1>
      <section className="mb-8">
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          {tr(locale, "Each Send back, returned fix or requested change is turned into a short standing lesson that is added to the agents' instructions. You get an e-mail every time. Switch any lesson off here.", "כל החזרה, תיקון שהוחזר או בקשת שינוי הופכים לקח קצר שנוסף להוראות הסוכנים. נשלח אליך מייל בכל פעם. אפשר לכבות כאן כל לקח.")}
        </p>
        {lessons.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{tr(locale, "Nothing learned yet.", "עדיין לא נלמד דבר.")}</p>
        ) : (
          <ul className="space-y-2">
            {lessons.map((lesson) => (
              <li key={lesson.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white px-4 py-3 dark:bg-slate-900 ${lesson.active ? "border-slate-200 dark:border-slate-800" : "border-dashed border-slate-300 opacity-60 dark:border-slate-700"}`}>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block text-sm text-slate-900 dark:text-slate-100">{lesson.lesson}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    {agentLabel(lesson.agent)} {"·"} {formatWhen(lesson.created_at, locale)}
                    {lesson.source_ticket_seq ? ` · TCK-${lesson.source_ticket_seq}` : ""}
                    {!lesson.active ? ` · ${tr(locale, "switched off", "כבוי")}` : ""}
                  </span>
                </span>
                <LessonToggle locale={locale} lessonId={lesson.id} active={lesson.active} />
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}
