import { notFound, redirect } from "next/navigation";

import { AutoHandlePill } from "@/components/auto-handle-pill";
import { FixPanel, ProposalPanel, QuestionsPanel, ReviewNav } from "@/components/ticket-review-panels";
import { formatTicketArea, formatTicketPriority, formatTicketType, normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import type { FixPayload, ProposalPayload, QuestionsPayload, TicketProposalRow } from "@/lib/ticket-proposals";
import { isCurrentUserAdmin } from "@/lib/tickets";

export const dynamic = "force-dynamic";

/** One ticket's proposal, questions or fix, for the admin to decide on (see ReviewPage). */
export default async function TicketReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      <AutoHandlePill locale={locale} value={ticket.auto_handle} />
    </div>
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-10">
      <ReviewNav locale={locale} backLabel={tr(locale, "Spec review", "סקירת אפיונים")} />
      {header}
      {proposal && proposal.kind === "proposal" ? (
        <ProposalPanel locale={locale} proposalId={proposal.id} payload={proposal.payload as ProposalPayload} />
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
          {ticket.auto_handle === "S"
            ? tr(locale, "Analysis is requested. The analyst runs every evening, or use Run analysis now on the review page.", "התבקש ניתוח. האנליסט רץ כל ערב, או אפשר להשתמש ב'הרצת ניתוח עכשיו' בדף הסקירה.")
            : ticket.auto_handle === "Y"
              ? tr(locale, "Queued: the night run picks this up with the brief that is already in the ticket.", "בתור: ריצת הלילה תיקח את זה עם התקציר שכבר נמצא בפנייה.")
              : tr(locale, "Nothing is waiting on you for this ticket.", "שום דבר לא ממתין לך בפנייה הזו.")}
        </p>
      )}
    </main>
  );
}
