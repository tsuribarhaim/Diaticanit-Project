import type { AppLocale } from "@/lib/locale";

/** The welcome email an admin can send when adding a new user (see the "Add new user" popup and the n8n "Welcome Invite" workflow).
 * Pure, so it can be rendered for any address and language without a database. One language per email, chosen by the admin. */

export const DAFFY_PUBLIC_URL = "https://daffy-pilot.vercel.app";

type Copy = {
  dir: "ltr" | "rtl";
  subject: string;
  heading: string;
  hello: string;
  what: string;
  open: string;
  installTitle: string;
  androidTitle: string;
  android: string[];
  iphoneTitle: string;
  iphone: string[];
  signUpTitle: string;
  signUp: (email: string) => string;
  footer: string;
};

const COPY: Record<AppLocale, Copy> = {
  en: {
    dir: "ltr",
    subject: "Welcome to Daffy",
    heading: "Welcome to Daffy",
    hello: "Hi,",
    what: "You have been invited to try <b>Daffy</b>, your daily AI health companion. Daffy helps you set nutrition, exercise and habit targets that adapt with you, and makes it easy to report your day and see how you are doing.",
    open: "Open Daffy",
    installTitle: "Install it on your phone",
    androidTitle: "Android (Chrome)",
    android: [
      "Open the link above in Chrome.",
      "Tap <b>Install</b> when it appears, or open the menu (&#8942;) and choose <b>Install app</b> (or <b>Add to Home screen</b>).",
      "Open Daffy from your home screen.",
    ],
    iphoneTitle: "iPhone (Safari)",
    iphone: [
      "Open the link above in <b>Safari</b> (not inside another app).",
      "Tap the <b>Share</b> button (the square with the arrow).",
      "Choose <b>Add to Home Screen</b>, then <b>Add</b>.",
      "Open Daffy from your home screen.",
    ],
    signUpTitle: "Sign up",
    signUp: (email) => `Tap <b>Sign up</b> and use <b>this email address</b> (${email}). Daffy will then guide you through a short onboarding.`,
    footer: "Daffy is currently a private pilot, so only invited email addresses can sign up. Questions? Just reply to this email.",
  },
  he: {
    dir: "rtl",
    subject: "ברוכים הבאים ל-Daffy",
    heading: "ברוכים הבאים ל-Daffy",
    hello: "שלום,",
    what: "הוזמנת לנסות את <b>Daffy</b>, המלווה הבריאותי היומי שלך עם בינה מלאכותית. Daffy עוזר לך להגדיר יעדי תזונה, פעילות והרגלים שמתאימים את עצמם אליך, ומקל על דיווח היום ועל מעקב אחרי ההתקדמות.",
    open: "פתיחת Daffy",
    installTitle: "התקנה בטלפון",
    androidTitle: "אנדרואיד (Chrome)",
    android: [
      "פתחו את הקישור למעלה ב-Chrome.",
      "הקישו על <b>התקנה</b> כשהיא מופיעה, או פתחו את התפריט (&#8942;) ובחרו <b>התקנת אפליקציה</b> (או <b>הוספה למסך הבית</b>).",
      "פתחו את Daffy ממסך הבית.",
    ],
    iphoneTitle: "אייפון (Safari)",
    iphone: [
      "פתחו את הקישור למעלה ב-<b>Safari</b> (ולא בתוך אפליקציה אחרת).",
      "הקישו על כפתור <b>שיתוף</b> (הריבוע עם החץ).",
      "בחרו <b>הוסף למסך הבית</b> ואז <b>הוסף</b>.",
      "פתחו את Daffy ממסך הבית.",
    ],
    signUpTitle: "הרשמה",
    signUp: (email) => `הקישו על <b>הרשמה</b> והשתמשו ב<b>כתובת האימייל הזו</b> (${email}). Daffy ידריך אתכם בהצטרפות קצרה.`,
    footer: "Daffy נמצא כרגע בפיילוט סגור, ולכן רק כתובות מוזמנות יכולות להירשם. שאלות? פשוט השיבו למייל הזה.",
  },
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderWelcomeEmail(input: { email: string; language: AppLocale }): { subject: string; html: string } {
  const c = COPY[input.language] ?? COPY.he;
  const list = (items: string[]) => `<ol style="margin:4px 0 12px;padding-${c.dir === "rtl" ? "right" : "left"}:22px">${items.map((item) => `<li style="margin-bottom:4px">${item}</li>`).join("")}</ol>`;
  const html = `<!doctype html><html dir="${c.dir}"><body style="margin:0;background:#f1f5f9;padding:20px 0">
<div dir="${c.dir}" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;text-align:${c.dir === "rtl" ? "right" : "left"}">
<div style="background:#0f766e;color:#ffffff;padding:18px 24px;font-size:20px;font-weight:700">${c.heading}</div>
<div style="padding:20px 24px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">${c.hello}</p>
<p style="margin:0 0 14px">${c.what}</p>
<p style="margin:0 0 6px"><a href="${DAFFY_PUBLIC_URL}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:11px 22px">${c.open}</a></p>
<p style="margin:0 0 4px;color:#64748b;font-size:13px" dir="ltr">${DAFFY_PUBLIC_URL}</p>
<h3 style="font-size:16px;margin:20px 0 6px">${c.installTitle}</h3>
<p style="margin:8px 0 2px"><b>${c.androidTitle}</b></p>${list(c.android)}
<p style="margin:8px 0 2px"><b>${c.iphoneTitle}</b></p>${list(c.iphone)}
<h3 style="font-size:16px;margin:20px 0 6px">${c.signUpTitle}</h3>
<p style="margin:0">${c.signUp(`<span dir="ltr">${esc(input.email)}</span>`)}</p>
</div>
<div style="padding:12px 24px;background:#f1f5f9;color:#64748b;font-size:12px">${c.footer}</div>
</div></body></html>`;
  return { subject: c.subject, html };
}
