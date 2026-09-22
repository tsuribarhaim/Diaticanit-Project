import Link from "next/link";
import { redirect } from "next/navigation";

import { NewTicketForm } from "@/components/new-ticket-form";
import { normalizeLocale, tr } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const locale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-10">
      <div className="mb-4">
        <Link href="/app/tickets" className="text-sm font-semibold text-teal-700 dark:text-teal-400">
          {tr(locale, "← My Tickets", "← הפניות שלי")}
        </Link>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tr(locale, "New Support Ticket", "פנייה חדשה לתמיכה")}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {tr(
            locale,
            "Report a bug or request a feature. Our support team reviews every ticket.",
            "דיווח על תקלה או בקשה לתכונה חדשה. צוות התמיכה שלנו בודק כל פנייה.",
          )}
        </p>

        <div className="mt-5">
          <NewTicketForm locale={locale} />
        </div>
      </section>
    </main>
  );
}
