import type { Metadata } from "next";

import { NavLink as Link } from "@/components/nav-link";

export const metadata: Metadata = {
  title: "Privacy Policy | Daffy",
  description: "How Daffy handles your information.",
};

const CONTACT = "daffy.healthcompanion@gmail.com";
const UPDATED = "9 October 2026";
const UPDATED_HE = "9 באוקטובר 2026";

type Section = { title: string; body: string[] };

const EN: Section[] = [
  {
    title: "Who we are",
    body: [
      "Daffy is a personal health companion app. It is currently a pilot (alpha) version, run by the Daffy team for a small group of invited users.",
      `Questions about this policy or your data: ${CONTACT}.`,
    ],
  },
  {
    title: "What we collect",
    body: [
      "Your account details (name and email address).",
      "The profile and health information you choose to enter, for example age, sex, height, weight, goals, allergies, medical conditions, medications and lifestyle habits.",
      "What you log in the app: meals, daily reports, targets, notifications, chat messages with the in-app coach, support tickets, and documents you upload (for example lab results).",
      "Basic technical data needed to keep you signed in and the app working, such as your time zone and sign-in activity.",
    ],
  },
  {
    title: "How we use it",
    body: [
      "To provide the app's features: your daily targets, reports, document reading and the in-app coach.",
      "To keep the service secure, fix problems and answer support requests.",
      "We do not sell your information and we do not use it for advertising.",
    ],
  },
  {
    title: "AI processing",
    body: [
      "Some features send the text or documents you give the app to a third-party AI provider (Anthropic, and in some features OpenAI) so that it can produce an answer, a summary or a suggestion for you. We send only what the feature needs, and only to provide that feature.",
      "Daffy's answers are general wellness information, not medical advice. Please talk to a qualified professional about medical decisions.",
    ],
  },
  {
    title: "Where it is stored and who can see it",
    body: [
      "Your data is kept with our hosting providers: Supabase (database and file storage) and Vercel (hosting). Data is encrypted in transit.",
      "Only you and the small Daffy team that runs the service can see your data, and the team uses it only to operate and support the service. We share it with service providers only as described above, or where the law requires it.",
    ],
  },
  {
    title: "Keeping and deleting your data",
    body: [`You can ask us to correct or delete your account and the data in it at any time by writing to ${CONTACT}. We will act on your request within a reasonable time.`],
  },
  {
    title: "Google user data",
    body: [
      "Daffy does not ask you for access to your Google account and does not read or use any end user's Google data.",
      `One Google account that belongs to the Daffy team (${CONTACT}) is connected to the team's own automation tool, only to send operational emails (such as daily summaries and release notices) to the team. That connection sends email only. It does not read, store, share or sell any email or other Google data.`,
      "Daffy's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
    ],
  },
  {
    title: "Changes",
    body: ["We may update this policy while Daffy is in its pilot. The date at the top shows the latest version."],
  },
];

const HE: Section[] = [
  {
    title: "מי אנחנו",
    body: [
      "Daffy היא אפליקציית מלווה בריאות אישית. כרגע זו גרסת פיילוט (אלפא), שמופעלת על ידי צוות Daffy עבור קבוצה קטנה של משתמשים מוזמנים.",
      `שאלות על המדיניות הזו או על המידע שלך: ${CONTACT}.`,
    ],
  },
  {
    title: "איזה מידע אנחנו אוספים",
    body: [
      "פרטי החשבון שלך (שם וכתובת אימייל).",
      "פרטי הפרופיל והמידע הבריאותי שאת/ה בוחר/ת להזין, למשל גיל, מין, גובה, משקל, מטרות, אלרגיות, מצבים רפואיים, תרופות והרגלי חיים.",
      "מה שאת/ה מתעד/ת באפליקציה: ארוחות, דוחות יומיים, יעדים, התראות, הודעות בצ'אט עם המאמן באפליקציה, פניות תמיכה ומסמכים שהועלו (למשל תוצאות בדיקות).",
      "נתונים טכניים בסיסיים הנחוצים כדי להשאיר אותך מחובר/ת ושהאפליקציה תפעל, כמו אזור זמן ופעילות כניסה.",
    ],
  },
  {
    title: "איך אנחנו משתמשים בו",
    body: [
      "כדי לספק את יכולות האפליקציה: יעדים יומיים, דוחות, קריאת מסמכים והמאמן באפליקציה.",
      "כדי לשמור על אבטחת השירות, לתקן תקלות ולענות לפניות תמיכה.",
      "אנחנו לא מוכרים את המידע שלך ולא משתמשים בו לפרסום.",
    ],
  },
  {
    title: "עיבוד בבינה מלאכותית",
    body: [
      "חלק מהיכולות שולחות את הטקסט או המסמכים שמסרת לאפליקציה לספק בינה מלאכותית של צד שלישי (Anthropic, ובחלק מהיכולות OpenAI) כדי שיפיק תשובה, סיכום או הצעה עבורך. אנחנו שולחים רק את מה שהיכולת צריכה, ורק כדי לספק אותה.",
      "התשובות של Daffy הן מידע כללי על רווחה ולא ייעוץ רפואי. בהחלטות רפואיות יש להיוועץ בגורם מקצועי מוסמך.",
    ],
  },
  {
    title: "איפה המידע נשמר ומי רואה אותו",
    body: [
      "המידע שלך נשמר אצל ספקי האחסון שלנו: Supabase (מסד נתונים ואחסון קבצים) ו-Vercel (אירוח). המידע מוצפן בהעברה.",
      "רק את/ה וצוות Daffy הקטן שמפעיל את השירות יכולים לראות את המידע, והצוות משתמש בו רק כדי להפעיל ולתמוך בשירות. אנחנו משתפים אותו עם ספקי שירות רק כמתואר לעיל, או כשהחוק מחייב.",
    ],
  },
  {
    title: "שמירה ומחיקה של המידע",
    body: [`אפשר לבקש מאיתנו לתקן או למחוק את החשבון ואת המידע שבו בכל עת, בכתובת ${CONTACT}. נטפל בבקשה בזמן סביר.`],
  },
  {
    title: "מידע ממשתמשי Google",
    body: [
      "Daffy לא מבקשת גישה לחשבון Google שלך, ולא קוראת או משתמשת במידע Google של אף משתמש קצה.",
      `חשבון Google אחד ששייך לצוות Daffy (${CONTACT}) מחובר לכלי האוטומציה של הצוות, אך ורק כדי לשלוח הודעות תפעוליות (כמו סיכומים יומיים והודעות על גרסאות) לצוות. החיבור הזה שולח אימייל בלבד. הוא לא קורא, לא שומר, לא משתף ולא מוכר אימיילים או מידע Google אחר.`,
      "השימוש של Daffy במידע שמתקבל מ-Google APIs עומד במדיניות הנתונים של Google API Services, כולל דרישות השימוש המוגבל (Limited Use).",
    ],
  },
  {
    title: "שינויים",
    body: ["ייתכן שנעדכן את המדיניות הזו בתקופת הפיילוט. התאריך בראש העמוד מציין את הגרסה העדכנית."],
  },
];

function Block({ lang, sections }: { lang: "en" | "he"; sections: Section[] }) {
  return (
    <div dir={lang === "he" ? "rtl" : "ltr"} lang={lang} className="space-y-6">
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{section.title}</h2>
          <div className="mt-1.5 space-y-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Public page (no sign-in): the privacy policy Google asks for on the OAuth consent screen, and a real policy for the app's users. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm font-semibold text-teal-700 dark:text-teal-400">
        ← Daffy
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Privacy Policy</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Last updated: {UPDATED}</p>
      <div className="mt-8">
        <Block lang="en" sections={EN} />
      </div>
      <hr className="my-10 border-slate-200 dark:border-slate-800" />
      <div dir="rtl" lang="he">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">מדיניות פרטיות</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">עודכן לאחרונה: {UPDATED_HE}</p>
      </div>
      <div className="mt-8">
        <Block lang="he" sections={HE} />
      </div>
    </main>
  );
}
