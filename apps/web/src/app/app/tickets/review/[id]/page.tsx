import { notFound, redirect } from "next/navigation";

import { AutoHandlePill } from "@/components/auto-handle-pill";
import { FixPanel, ProposalPanel, QuestionsPanel, RequeueButton, ReviewNav } from "@/components/ticket-review-panels";
import { formatTicketArea, formatTicketPriority, formatTicketType, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import type { FixPayload, ProposalPayload, QuestionsPayload, TicketProposalRow } from "@/lib/ticket-proposals";
import { isCurrentUserAdmin } from "@/lib/tickets";
import { TicketTrail } from "@/components/ticket-trail";
import { NAV_HREF, navLabel, parseFrom } from "@/lib/tickets-nav";

export const dynamic = "force-dynamic";

// Wrapped so the clock is read in one place (the render must not call Date.now directly).
const now = () => Date.now();

/** One ticket's proposal, questions or fix, for the admin to decide on (see ReviewPage). */
export default async function TicketReviewDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const from = parseFrom((await searchParams).from, "review");
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user) redirect("/auth/sign-in");

  const locale: AppLocale = normalizeLocale(
    (await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language,
  );
  if (!(await isCurrentUserAdmin(supabase, user.id))) redirect("/app/tickets");

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, ticket_seq, subject, ticket_type, area, priority, status, auto_handle, created_by")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();

  const wantedKind = ticket.auto_handle === "A" ? "proposal" : ticket.auto_handle === "P" ? "questions" : (ticket.auto_handle === "D" || ticket.auto_handle === "M" || ticket.auto_handle === "R") ? "fix" : null;
  let proposal: TicketProposalRow | null = null;
  if (wantedKind) {
    const { data } = await supabase
      .from("ticket_proposals")
      .select("*")
      .eq("ticket_id", id)
      .eq("kind", wantedKind)
      .in("status", wantedKind === "fix" ? ["pending", "merged", "approved"] : ["pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    proposal = (data as TicketProposalRow | null) ?? null;
  }

  // A ticket the night run flagged P with no question row: it is being built right now, or it stopped without a reason on file.
  let buildState: "building" | "stopped" | null = null;
  if (ticket.auto_handle === "P" && !proposal) {
    const { data: settings } = await supabase.from("automation_settings").select("bridge_seen_at, bridge_status").eq("id", true).maybeSingle();
    const online = settings?.bridge_seen_at ? now() - new Date(settings.bridge_seen_at as string).getTime() < 3 * 60 * 1000 : false;
    const running = online && Boolean((settings?.bridge_status as { runInProgress?: boolean } | null)?.runInProgress);
    const { data: nightOpen } = await supabase.from("automation_requests").select("id").eq("kind", "night").is("completed_at", null).limit(1);
    buildState = running || (nightOpen ?? []).length > 0 ? "building" : "stopped";
  }

  let mergeRequested = false;
  let mergeResult: string | null = null;
  let revertRequested = false;
  let revertResult: string | null = null;
  if (wantedKind === "fix") {
    const { data: reverts } = await supabase
      .from("automation_requests")
      .select("completed_at, result")
      .eq("kind", "revert")
      .eq("ticket_id", id)
      .order("requested_at", { ascending: false })
      .limit(1);
    const lastRevert = reverts?.[0];
    revertRequested = Boolean(lastRevert && !lastRevert.completed_at);
    // A finished revert that left the ticket on dev means it failed: show why.
    revertResult = lastRevert?.completed_at && ticket.auto_handle !== "D" ? (lastRevert.result ?? null) : null;
    const { data: requests } = await supabase
      .from("automation_requests")
      .select("completed_at, result")
      .eq("kind", "merge")
      .eq("ticket_id", id)
      .order("requested_at", { ascending: false })
      .limit(1);
    const latest = requests?.[0];
    mergeRequested = Boolean(latest && !latest.completed_at);
    mergeResult = latest?.completed_at ? (latest.result ?? null) : null;
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">TCK-{ticket.ticket_seq}</p>
        <h1 dir="auto" className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">
          {ticket.subject}
        </h1>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {ticket.ticket_type ? formatTicketType(ticket.ticket_type, locale) : tr(locale, "Not set yet", "טרם נבחר")} {"·"}{" "}
          {ticket.area ? formatTicketArea(ticket.area, locale) : tr(locale, "Not set yet", "טרם נבחר")} {"·"} {formatTicketPriority(ticket.priority, locale)}
        </p>
      </div>
      {buildState ? (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${buildState === "building" ? "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"}`}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {buildState === "building" ? tr(locale, "Being built by the night run", "בבנייה בריצת הלילה") : tr(locale, "Night run stopped", "ריצת הלילה נעצרה")}
        </span>
      ) : (
        <AutoHandlePill locale={locale} value={ticket.auto_handle} />
      )}
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <TicketTrail
        locale={locale}
        items={[
          { label: navLabel(locale, from), href: NAV_HREF[from] },
          { label: `TCK-${ticket.ticket_seq} ${tr(locale, "review", "סקירה")}` },
        ]}
      />
      <ReviewNav locale={locale} backLabel={navLabel(locale, from)} backHref={NAV_HREF[from]} />
      {header}
      {proposal && proposal.kind === "proposal" ? (
        <ProposalPanel locale={locale} proposalId={proposal.id} ticketId={ticket.id} payload={proposal.payload as ProposalPayload} ticketSeq={ticket.ticket_seq} subject={ticket.subject} />
      ) : proposal && proposal.kind === "questions" ? (
        <QuestionsPanel locale={locale} proposalId={proposal.id} payload={proposal.payload as QuestionsPayload} />
      ) : proposal && proposal.kind === "fix" ? (
        <FixPanel
          locale={locale}
          proposalId={proposal.id}
          payload={proposal.payload as FixPayload}
          stage={proposal.status === "approved" ? "approved" : proposal.status === "merged" ? "dev" : "branch"}
          mergeRequested={mergeRequested}
          mergeResult={mergeResult}
          revertRequested={revertRequested}
          revertResult={revertResult}
        />
      ) : (
        <p className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {buildState === "building"
            ? tr(locale, "The night run is building this fix right now. It appears here when it is done, usually within 10 minutes.", "ריצת הלילה בונה את התיקון עכשיו. הוא יופיע כאן כשיסתיים, בדרך כלל תוך 10 דקות.")
            : buildState === "stopped"
              ? tr(locale, "The night run stopped before it finished and left no reason on file. You can put the ticket back in the queue for the next run.", "ריצת הלילה נעצרה לפני שסיימה ולא השאירה סיבה. אפשר להחזיר את הפנייה לתור לריצה הבאה.")
              : ticket.auto_handle === "S"
            ? tr(locale, "Analysis is requested. The analyst runs every evening, or use Run analysis now on the review page.", "התבקש ניתוח. האנליסט רץ כל ערב, או אפשר להשתמש ב'הרצת ניתוח עכשיו' בדף הסקירה.")
            : ticket.auto_handle === "Y"
              ? tr(locale, "Queued: the night run picks this up with the brief that is already in the ticket.", "בתור: ריצת הלילה תיקח את זה עם התקציר שכבר נמצא בפנייה.")
              : tr(locale, "Nothing is waiting on you for this ticket.", "שום דבר לא ממתין לך בפנייה הזו.")}
          {buildState === "stopped" ? (
            <span className="mt-3 block">
              <RequeueButton locale={locale} ticketId={ticket.id} />
            </span>
          ) : null}
        </p>
      )}
    </main>
  );
}
