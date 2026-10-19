"use server";

import { israelDate, loadAiPerson, parsePeriod, type AiPersonDetail } from "@/lib/ai-usage-report";
import { logServerError } from "@/lib/server-log";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

/** One person's AI use for the AI usage page's side panel. Admins only. */
export async function getAiPersonAction(userId: string, gran: string, date: string): Promise<{ detail?: AiPersonDetail; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthenticatedUser();
  if (!user || !(await isCurrentUserAdmin(supabase, user.id))) return { error: "forbidden" };
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "bad_user" };
  const today = israelDate(new Date());
  try {
    return { detail: await loadAiPerson(supabase, userId, parsePeriod(gran, date, today), today) };
  } catch (err) {
    logServerError("aiUsagePerson", "load_failed", { userId, error: err instanceof Error ? err.message : String(err) });
    return { error: "load_failed" };
  }
}
