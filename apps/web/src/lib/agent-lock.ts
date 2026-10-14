import { tr, type AppLocale } from "@/lib/locale";

/**
 * One agent at a time (daily batch design): the analyst, the night run, the daily triage and a promotion never run
 * together - the bridge enforces it (automation/n8n/bridge/server.js, agentBusy), and the app refuses a manual "run now"
 * while any of them runs, so the admin never starts one on top of another.
 */
export type BridgeHealth = { analysisInProgress?: boolean; runInProgress?: boolean; promoteInProgress?: boolean; triageInProgress?: boolean };
export type BusyAgent = "night" | "analyze" | "triage" | "promote";

/** What the bridge is running now, by its last heartbeat (null when idle, or when the heartbeat is too old to trust). */
export function busyAgent(health: BridgeHealth | null | undefined, heartbeatFresh: boolean): BusyAgent | null {
  if (!heartbeatFresh || !health) return null;
  if (health.runInProgress) return "night";
  if (health.analysisInProgress) return "analyze";
  if (health.triageInProgress) return "triage";
  if (health.promoteInProgress) return "promote";
  return null;
}

export function busyAgentLabel(agent: BusyAgent, locale: AppLocale): string {
  if (agent === "night") return tr(locale, "the night run", "ריצת הלילה");
  if (agent === "analyze") return tr(locale, "the analyst", "האנליסט");
  if (agent === "triage") return tr(locale, "the daily triage", "הסריקה היומית");
  return tr(locale, "a promotion", "העלאה לייצור");
}
