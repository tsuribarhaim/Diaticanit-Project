import type { AppLocale } from "@/lib/locale";
import { renderPasswordResetEmail } from "@/lib/password-reset-email";
import { logServerError } from "@/lib/server-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAFFY_PUBLIC_URL } from "@/lib/welcome-email";

/**
 * TCK-3: "Forgot your password?" sends a reset link from Daffy's own address. Asking only leaves an automation_requests row
 * ('password_reset': the email and the language); the n8n poller hands it to the "Password Reset" workflow, which calls
 * buildPasswordResetEmail through /api/admin/automation-requests and sends the result. The one-time link is made at that
 * moment and is never stored in our database.
 *
 * The link is a token_hash checked on the server (/auth/confirm -> verifyOtp), so it works in any browser or device - the
 * old Supabase link needed the browser that asked for it, and failed when the email opened somewhere else.
 */

const MAX_PER_HOUR = 3;
/** Where the link points: production, unless this deployment says otherwise (dev uses the laptop's own address). */
const linkBase = () => (process.env.RESET_LINK_BASE_URL || DAFFY_PUBLIC_URL).replace(/\/+$/, "");

async function accountExists(admin: ReturnType<typeof createAdminClient>, email: string): Promise<boolean> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    if (data.users.some((account) => account.email?.toLowerCase() === email)) return true;
    if (data.users.length < 1000) return false;
  }
  return false;
}

/** Queues a reset email for this address. Says nothing about whether it has an account (callers show the same message either
 * way), and quietly skips an address that already got MAX_PER_HOUR in the last hour, so the form cannot be used to flood a mailbox. */
export async function queuePasswordReset(rawEmail: string, language: AppLocale, requestedBy: string | null): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  const admin = createAdminClient();
  try {
    if (!(await accountExists(admin, email))) return;
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from("automation_requests").select("id", { count: "exact", head: true }).eq("kind", "password_reset").eq("details->>email", email).gte("requested_at", hourAgo);
    if ((count ?? 0) >= MAX_PER_HOUR) return;
    const { error } = await admin.from("automation_requests").insert({ kind: "password_reset", requested_by: requestedBy, details: { email, language } });
    if (error) logServerError("auth.passwordReset", "queue_failed", { error: error.message });
  } catch (error) {
    logServerError("auth.passwordReset", "queue_failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The email for one queued request, with a fresh one-time link. Null when the request is not a password reset. */
export async function buildPasswordResetEmail(requestId: string): Promise<{ to: string; subject: string; html: string; text: string } | null> {
  const admin = createAdminClient();
  const { data: row } = await admin.from("automation_requests").select("kind, details").eq("id", requestId).maybeSingle();
  const details = (row?.details ?? {}) as { email?: unknown; language?: unknown };
  if (!row || row.kind !== "password_reset" || typeof details.email !== "string" || !details.email) return null;
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email: details.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw new Error(`Could not create the reset link: ${error?.message ?? "no token"}`);
  const link = `${linkBase()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const email = renderPasswordResetEmail({ link, language: details.language === "en" ? "en" : "he" });
  return { to: details.email, ...email };
}
