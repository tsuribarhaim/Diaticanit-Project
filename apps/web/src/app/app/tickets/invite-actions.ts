"use server";

import { promises as dns } from "node:dns";

import { normalizeLocale, tr, type AppLocale } from "@/lib/locale";
import { checkInviteEmailFormat } from "@/lib/pilot-invite";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserAdmin } from "@/lib/tickets";

export type AddUserState = {
  error?: string;
  /** The (lowercase) address that was added, or was already on the list. */
  added?: string;
  alreadyThere?: boolean;
};

/** Does this domain exist and accept mail? True when it has MX records or, failing that, an address record (mail then goes to the host
 * itself). A "does not exist" answer is a clear no; a timeout or any other network trouble is NOT treated as a no, so a flaky lookup never
 * blocks a real address. */
async function domainAcceptsMail(domain: string): Promise<boolean> {
  const lookup = async <T,>(run: () => Promise<T[]>): Promise<"yes" | "no" | "unknown"> => {
    try {
      return (await run()).length > 0 ? "yes" : "no";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOTFOUND" || code === "ENODATA" ? "no" : "unknown";
    }
  };
  const mx = await lookup(() => dns.resolveMx(domain));
  if (mx === "yes" || mx === "unknown") return true;
  const a = await lookup(() => dns.resolve4(domain));
  if (a === "yes" || a === "unknown") return true;
  const aaaa = await lookup(() => dns.resolve6(domain));
  return aaaa !== "no";
}

/** Admin only: lets one more person sign up, by adding their email to pilot_allowlist (the invite list signUpAction checks). Written with
 * the service-role client because that table has no RLS policy at all; the admin check below is therefore the only gate, and it runs on
 * the server for every call. */
export async function addPilotUserAction(_previous: AddUserState, formData: FormData): Promise<AddUserState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("user_profile").select("preferred_language").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const locale: AppLocale = normalizeLocale(profile?.preferred_language);

  if (!user || !(await isCurrentUserAdmin(supabase, user.id))) {
    return { error: tr(locale, "Only an admin can add users.", "רק מנהל יכול להוסיף משתמשים.") };
  }

  const checked = checkInviteEmailFormat(String(formData.get("email") ?? ""), locale);
  if (!checked.ok) return { error: checked.error };

  if (!(await domainAcceptsMail(checked.domain))) {
    return {
      error: tr(
        locale,
        `The domain ${checked.domain} does not exist or cannot receive email. Please check the spelling after the @.`,
        `הדומיין ${checked.domain} לא קיים או לא מקבל אימיילים. יש לבדוק את האיות אחרי ה-@.`,
      ),
    };
  }

  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin.from("pilot_allowlist").select("email").eq("email", checked.email).maybeSingle();
  if (lookupError) {
    logServerError("tickets.addPilotUser", "lookup_failed", { error: lookupError.message });
    return { error: tr(locale, "Something went wrong. Please try again in a moment.", "משהו השתבש. יש לנסות שוב בעוד רגע.") };
  }
  if (existing) return { added: checked.email, alreadyThere: true };

  const { error: insertError } = await admin
    .from("pilot_allowlist")
    .insert({ email: checked.email, notes: `Added by admin on ${new Date().toISOString().slice(0, 10)}` });
  if (insertError) {
    logServerError("tickets.addPilotUser", "insert_failed", { error: insertError.message });
    return { error: tr(locale, "Something went wrong. Please try again in a moment.", "משהו השתבש. יש לנסות שוב בעוד רגע.") };
  }

  return { added: checked.email };
}
