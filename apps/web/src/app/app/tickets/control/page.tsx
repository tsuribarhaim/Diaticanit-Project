import { redirect } from "next/navigation";

import { ControlRoomView } from "@/components/control-room-view";
import { getControlRoom } from "@/lib/control-room";
import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** The control room (lib/control-room.ts): everything the automation does - now, queues, timeline, tonight's plan, log. */
export default async function ControlRoomPage({ searchParams }: { searchParams: Promise<{ day?: string; view?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");
  const locale: AppLocale = normalizeLocale((await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language);
  const params = await searchParams;
  const dayOffset = params.day === "1" ? 1 : 0;
  const data = await getControlRoom(supabase, locale, dayOffset);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">{tr(locale, "Control room", "מרכז בקרה")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{tr(locale, "Everything the automation does: what runs now, what waits and for whom, what was done and by whom.", "כל מה שהאוטומציה עושה: מה רץ עכשיו, מה מחכה ולמי, מה נעשה ועל ידי מי.")}</p>
      </header>
      <ControlRoomView locale={locale} data={data} dayOffset={dayOffset} initialView={["queues", "timeline", "tonight", "log"].includes(params.view ?? "") ? (params.view as "queues") : "queues"} />
    </main>
  );
}
