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
  /** A welcome email was asked for: queued for the n8n poller (sent within about a minute), or the request could not be saved. */
  emailQueued?: AppLocale;
  emailFailed?: boolean;
  /** On the list already, so no email was sent; the popup offers to send the welcome email anyway (when the box was ticked). */
  resendOffered?: boolean;
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

/** Is there already a registered account with this (lowercase) email? supabase-js has no lookup by email, so this pages through the
 * accounts (a pilot has a few dozen; the cap of 20 pages x 1000 is far beyond that). */
async function accountExists(admin: ReturnType<typeof createAdminClient>, email: string): Promise<boolean> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    if (data.users.some((account) => account.email?.toLowerCase() === email)) return true;
    if (data.users.length < 1000) return false;
  }
  return false;
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

  // The popup's "Send a welcome email" box, with the language it should be in (Hebrew unless the admin chose English).
  const wantsEmail = formData.get("send_email") === "on";
  const emailLanguage: AppLocale = formData.get("language") === "en" ? "en" : "he";

  const admin = createAdminClient();
  try {
    if (await accountExists(admin, checked.email)) {
      return { error: tr(locale, "This email already has a Daffy account, so there is nothing to add.", "לכתובת האימייל הזו כבר יש חשבון ב-Daffy, ולכן אין מה להוסיף.") };
    }
  } catch (accountError) {
    logServerError("tickets.addPilotUser", "account_lookup_failed", { error: accountError instanceof Error ? accountError.message : String(accountError) });
    return { error: tr(locale, "Something went wrong. Please try again in a moment.", "משהו השתבש. יש לנסות שוב בעוד רגע.") };
  }
  const { data: existing, error: lookupError } = await admin.from("pilot_allowlist").select("email").eq("email", checked.email).maybeSingle();
  if (lookupError) {
    logServerError("tickets.addPilotUser", "lookup_failed", { error: lookupError.message });
    return { error: tr(locale, "Something went wrong. Please try again in a moment.", "משהו השתבש. יש לנסות שוב בעוד רגע.") };
  }
  // The email itself is sent by the n8n "Welcome Invite" workflow: the app cannot reach the admin's laptop, so it leaves a request that the
  // poller picks up (see automation_requests kind 'invite'). The user is on the list either way: a failed request only means nobody told them.
  const queueEmail = async (): Promise<Pick<AddUserState, "emailQueued" | "emailFailed">> => {
    if (!wantsEmail) return {};
    const { error: requestError } = await admin
      .from("automation_requests")
      .insert({ kind: "invite", requested_by: user.id, details: { email: checked.email, language: emailLanguage } });
    if (requestError) {
      logServerError("tickets.addPilotUser", "invite_request_failed", { error: requestError.message });
      return { emailFailed: true };
    }
    return { emailQueued: emailLanguage };
  };

  // Already invited and not signed up yet: nothing to add. A welcome email goes out only when the admin asks for it again (the "resend" button).
  if (existing) {
    if (formData.get("resend") === "1") return { added: checked.email, alreadyThere: true, ...(await queueEmail()) };
    return { added: checked.email, alreadyThere: true, resendOffered: wantsEmail };
  }

  const { error: insertError } = await admin
    .from("pilot_allowlist")
    .insert({ email: checked.email, notes: `Added by admin on ${new Date().toISOString().slice(0, 10)}` });
  if (insertError) {
    logServerError("tickets.addPilotUser", "insert_failed", { error: insertError.message });
    return { error: tr(locale, "Something went wrong. Please try again in a moment.", "משהו השתבש. יש לנסות שוב בעוד רגע.") };
  }

  return { added: checked.email, ...(await queueEmail()) };
}
