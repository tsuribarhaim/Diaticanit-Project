"use server";

import { getTicketJourney, type JourneyStep } from "@/lib/control-room";
import { normalizeLocale } from "@/lib/locale";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

/** The control room's journey panel: one ticket's way through the automation (admins only). */
export async function ticketJourneyAction(ticketId: string): Promise<{ seq: number; subject: string; steps: JourneyStep[] } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user || !(await isCurrentUserAdmin(supabase, user.id))) return null;
  const locale = normalizeLocale((await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()).data?.preferred_language);
  return getTicketJourney(supabase, locale, ticketId);
}
