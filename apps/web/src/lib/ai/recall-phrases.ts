import { createAdminClient } from "@/lib/supabase/admin";
import { logServerError } from "@/lib/server-log";

/**
 * TCK-69 cost fix: the Daily report chat sends the user's earlier days only when the conversation refers back to one
 * ("another portion of yesterday's lasagna"). Which words count is reference data in chat_recall_phrases
 * (db/migrations/084_chat_recall_phrases.sql) - a new phrase is picked up within CACHE_MS, no deploy. The list below is
 * the same starter set, used only when the table cannot be read, so recalling never silently stops working.
 */
const FALLBACK_PHRASES = [
  "אתמול", "שלשום", "שאריות", "שארית", "שנשאר", "עוד מנה", "מנה נוספת", "עוד פעם", "שוב", "אותו דבר", "אותה מנה", "כמו ב",
  "יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "בשבת", "משבת",
  "yesterday", "leftover", "same as", "another portion", "another serving", "again", "the day before", "last night",
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];
const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; phrases: string[] } | null = null;

/** Lower case, Hebrew vowel marks and cantillation removed, spaces collapsed - so matching ignores how a word is typed. */
export function normalizeForRecall(text: string): string {
  return text.normalize("NFC").replace(/[֑-ׇ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function getRecallPhrases(): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.phrases;
  try {
    const { data, error } = await createAdminClient().from("chat_recall_phrases").select("phrase").eq("active", true);
    if (error) throw new Error(error.message);
    const phrases = (data ?? []).map((row) => normalizeForRecall(String(row.phrase))).filter(Boolean);
    cached = { at: Date.now(), phrases: phrases.length ? phrases : FALLBACK_PHRASES.map(normalizeForRecall) };
  } catch (err) {
    logServerError("recallPhrases", "load_failed", { error: err instanceof Error ? err.message : String(err) });
    cached = { at: Date.now(), phrases: FALLBACK_PHRASES.map(normalizeForRecall) };
  }
  return cached.phrases;
}

/** True when any of the texts (the user's messages in this conversation) contains a recall phrase. */
export function refersToEarlierDay(texts: string[], phrases: string[]): boolean {
  return texts.some((text) => {
    const t = normalizeForRecall(text);
    return t.length > 0 && phrases.some((p) => t.includes(p));
  });
}
