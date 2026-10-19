import { tr, type AppLocale } from "@/lib/locale";

/** The app's pages and AI features by the names people know them by (the AI usage page, lib/ai/usage.ts). */
const PAGES: Record<string, [string, string]> = {
  "/app": ["Home", "בית"],
  "/app/daily-report": ["Daily report", "דיווח יומי"],
  "/app/daily-report/defaults": ["Saved list", "רשימה שמורה"],
  "/app/targets": ["Targets", "יעדים"],
  "/app/profile": ["Profile", "פרופיל"],
  "/app/onboarding": ["Onboarding", "הרשמה"],
  "/app/documents": ["Documents", "מסמכים"],
  "/app/chat": ["Daffy chat", "צ'אט עם דפי"],
  "/app/settings": ["Settings", "הגדרות"],
  "/app/tickets": ["Tickets", "פניות"],
};

export function aiPageLabel(locale: AppLocale, page: string | null): string {
  if (!page) return tr(locale, "Unknown page", "עמוד לא ידוע");
  const known = PAGES[page] ?? PAGES[page.split("/").slice(0, 3).join("/")];
  return known ? tr(locale, known[0], known[1]) : page;
}

const FEATURES: Record<string, [string, string]> = {
  report_parse: ["Read a typed report", "קריאת דיווח מוקלד"],
  report_photo: ["Read a photo", "קריאת תמונה"],
  report_unit_match: ["Match units", "התאמת יחידות"],
  report_clarify_check: ["Clarification check", "בדיקת הבהרה"],
  report_chat: ["Report chat reply", "תשובה בצ'אט הדיווח"],
  chat_route: ["Route a chat message", "ניתוב הודעה בצ'אט"],
  help_answer: ["Help answer", "תשובת עזרה"],
  home_coach: ["Coach message", "הודעת המאמנת"],
  profile_chat: ["Profile chat", "צ'אט פרופיל"],
  profile_text: ["Check profile text", "בדיקת טקסט פרופיל"],
  targets_generate: ["Generate targets", "יצירת יעדים"],
  targets_quick_classify: ["Quick edit of a target", "עריכה מהירה של יעד"],
  targets_quick_safety: ["Safety check of a quick edit", "בדיקת בטיחות לעריכה מהירה"],
  doc_extract: ["Read a document", "קריאת מסמך"],
};

export function aiFeatureLabel(locale: AppLocale, feature: string): string {
  const known = FEATURES[feature];
  return known ? tr(locale, known[0], known[1]) : feature;
}
