"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { markNotificationRead } from "@/lib/notifications";
import { revalidateNavChrome } from "@/lib/nav-chrome";
import { createClient } from "@/lib/supabase/server";

/**
 * The only user-triggered write to read_at outside a click-through (see
 * targets/page.tsx's ?concern= handling and tickets/[id]/page.tsx's own
 * copy of the same pattern, both of which already call markNotificationRead
 * as a side effect of landing on the thing the notification was about).
 * This is for dismissing an info notification directly from the list,
 * without needing to click through anywhere - see nav-chrome.ts's own
 * comment on why marking a *concern* notification read this way still
 * wouldn't reduce the nav badge even if a caller tried; only info
 * notifications actually change the count here.
 */
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const notificationId = formData.get("notification_id")?.toString();
  if (!notificationId) return;

  await markNotificationRead({ supabase, userId: user.id, notificationId });

  revalidateNavChrome();
  revalidatePath("/app/notifications");
}
