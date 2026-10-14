import type { AppLocale } from "@/lib/locale";

/** The "reset your password" email (TCK-3), sent from Daffy's own address by the n8n "Password Reset" workflow, in the same
 * style as the welcome email. Pure: the one-time link is built by the caller at send time. A plain-text copy goes with the
 * HTML, so spam filters see a normal message. */

type Copy = { dir: "ltr" | "rtl"; subject: string; heading: string; hello: string; why: string; button: string; orCopy: string; expiry: string; notYou: string; footer: string };

const COPY: Record<AppLocale, Copy> = {
  en: {
    dir: "ltr",
    subject: "Reset your Daffy password",
    heading: "Reset your password",
    hello: "Hi,",
    why: "Someone (hopefully you) asked to reset the password of the Daffy account for this email address. Tap the button to choose a new password.",
    button: "Choose a new password",
    orCopy: "Or copy this link into your browser:",
    expiry: "The link works once and expires in one hour.",
    notYou: "Didn't ask for this? You can ignore this email: your password stays the same.",
    footer: "Daffy, your daily AI health companion.",
  },
  he: {
    dir: "rtl",
    subject: "איפוס הסיסמה ל-Daffy",
    heading: "איפוס סיסמה",
    hello: "שלום,",
    why: "התקבלה בקשה לאפס את הסיסמה של חשבון ה-Daffy של כתובת האימייל הזו. הקישו על הכפתור כדי לבחור סיסמה חדשה.",
    button: "בחירת סיסמה חדשה",
    orCopy: "או העתיקו את הקישור הזה לדפדפן:",
    expiry: "הקישור עובד פעם אחת ותוקפו פג בעוד שעה.",
    notYou: "לא ביקשתם את זה? אפשר להתעלם מהמייל, והסיסמה תישאר כפי שהיא.",
    footer: "Daffy, המלווה הבריאותי היומי שלך.",
  },
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderPasswordResetEmail(input: { link: string; language: AppLocale }): { subject: string; html: string; text: string } {
  const c = COPY[input.language] ?? COPY.he;
  const link = esc(input.link);
  const align = c.dir === "rtl" ? "right" : "left";
  const html = `<!doctype html><html dir="${c.dir}"><body style="margin:0;background:#f1f5f9;padding:20px 0">
<div dir="${c.dir}" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;text-align:${align}">
<div style="background:#0f766e;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:700">${c.heading}</div>
<div style="padding:20px 24px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">${c.hello}</p>
<p style="margin:0 0 16px">${c.why}</p>
<p style="margin:0 0 14px"><a href="${link}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:11px 22px">${c.button}</a></p>
<p style="margin:0 0 4px;color:#64748b;font-size:13px">${c.orCopy}</p>
<p dir="ltr" style="margin:0 0 14px;color:#0f766e;font-size:12px;word-break:break-all;text-align:left">${link}</p>
<p style="margin:0 0 8px;color:#334155;font-size:14px">${c.expiry}</p>
<p style="margin:0;color:#64748b;font-size:13px">${c.notYou}</p>
</div>
<div style="padding:12px 24px;background:#f1f5f9;color:#64748b;font-size:12px">${c.footer}</div>
</div></body></html>`;
  const text = [c.heading, "", c.hello, c.why.replace(/<[^>]+>/g, ""), "", `${c.button}: ${input.link}`, "", c.expiry, c.notYou, "", c.footer].join("\n");
  return { subject: c.subject, html, text };
}
