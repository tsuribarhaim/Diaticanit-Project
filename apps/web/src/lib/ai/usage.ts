import { AsyncLocalStorage } from "node:async_hooks";

import { headers } from "next/headers";
import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { logServerError } from "@/lib/server-log";

/**
 * AI cost per person (db/migrations/083_ai_usage.sql): every AI call the app makes for someone is recorded as one
 * ai_usage row - who, which page and feature, the tokens the provider reported and what they cost. Only counts and
 * labels are kept, never the prompt or the reply. The ticket automation never goes through the app's AI client, so it
 * is not part of these numbers.
 *
 * provider-client.ts calls beginAiUsage() when a call starts and the returned finish() when it ends. The person and the
 * page are read from the request while the provider is still answering, so recording adds no wait; the row is written
 * after the response (Next's after()), and a failed write is logged and dropped - it never reaches the user.
 */

/** What the AI call was for. One per AI function in lib/ai; the admin view groups and labels by it. */
export type AiFeature =
  | "report_parse"
  | "report_photo"
  | "report_unit_match"
  | "report_clarify_check"
  | "report_chat"
  | "chat_route"
  | "help_answer"
  | "home_coach"
  | "profile_chat"
  | "profile_text"
  | "targets_generate"
  | "targets_quick_classify"
  | "targets_quick_safety"
  | "doc_extract";

/** page = the app page the person was on; floating_chat = the chat bubble, recorded on the page it was opened from. */
export type AiSurface = "page" | "floating_chat";

export type AiUsageTag = {
  feature: AiFeature;
  /** Only when the request cannot tell (a page rendered on the server sees the previous page as its referer). */
  page?: string;
  surface?: AiSurface;
  conversationId?: string | null;
};

type AiUsageContext = { surface?: AiSurface; page?: string; conversationId?: string | null };
const contextStore = new AsyncLocalStorage<AiUsageContext>();

/** Tags every AI call made inside fn - used by the floating chat's actions, so the functions they share with the pages
 * (reading a report, for example) are recorded as chat use without passing a flag through every layer. */
export function runWithAiUsageContext<T>(context: AiUsageContext, fn: () => Promise<T>): Promise<T> {
  return contextStore.run(context, fn);
}

export type AiTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const NO_TOKENS: AiTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * USD per million tokens, Anthropic first-party rates (checked 2026-10-19). cacheWrite is the 5-minute cache write
 * (1.25x input). input_tokens from the API is the uncached part only, so the four counts add up to the whole prompt.
 * A model missing here is recorded with its tokens and no cost; add it and bump the version to reprice from tokens.
 */
export const AI_PRICE_VERSION = "2026-10-19";
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export function priceAiCall(model: string, tokens: AiTokens): { input: number; output: number; cache: number; total: number } | null {
  const price = PRICES[model];
  if (!price) return null;
  const input = (tokens.input * price.input) / 1e6;
  const output = (tokens.output * price.output) / 1e6;
  const cache = (tokens.cacheRead * price.cacheRead + tokens.cacheWrite * price.cacheWrite) / 1e6;
  return { input, output, cache, total: input + output + cache };
}

/** /app/targets/5f1c… -> /app/targets/:id - one row per page, not per record. */
export function canonicalPage(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  let path = pathOrUrl;
  try {
    path = new URL(pathOrUrl, "http://local").pathname;
  } catch {
    return null;
  }
  const parts = path
    .split("/")
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || /^\d+$/.test(part) ? ":id" : part));
  return `/${parts.join("/")}`.slice(0, 120);
}

export type AiCallOutcome = {
  provider: string;
  model: string;
  tokens: AiTokens;
  status: "ok" | "error" | "timeout";
  errorCode?: string | null;
  requestId?: string | null;
  streamed: boolean;
  firstTokenMs?: number | null;
  attempt?: number;
};

type RequestFacts = { userId: string | null; referer: string | null };

/** Never rejects: a call made outside a request (a script, a test) is recorded without a person or a page. */
async function readRequestFacts(): Promise<RequestFacts> {
  let referer: string | null = null;
  let userId: string | null = null;
  try {
    referer = (await headers()).get("referer");
  } catch {
    // Not inside a request.
  }
  try {
    const { data } = await getAuthenticatedUser();
    userId = data.user?.id ?? null;
  } catch {
    // Not inside a request, or no session.
  }
  return { userId, referer };
}

async function writeUsageRow(tag: AiUsageTag, context: AiUsageContext, facts: RequestFacts, outcome: AiCallOutcome, durationMs: number) {
  try {
    const admin = createAdminClient();
    let isAdmin = false;
    let locale: string | null = null;
    if (facts.userId) {
      const { data } = await admin.from("user_profile").select("is_admin, preferred_language").eq("user_id", facts.userId).maybeSingle();
      isAdmin = Boolean(data?.is_admin);
      locale = (data?.preferred_language as string | null) ?? null;
    }
    const cost = priceAiCall(outcome.model, outcome.tokens);
    const { error } = await admin.from("ai_usage").insert({
      user_id: facts.userId,
      is_admin: isAdmin,
      page: tag.page ?? context.page ?? canonicalPage(facts.referer),
      surface: tag.surface ?? context.surface ?? "page",
      feature: tag.feature,
      conversation_id: tag.conversationId ?? context.conversationId ?? null,
      locale,
      provider: outcome.provider,
      model: outcome.model,
      provider_request_id: outcome.requestId ?? null,
      input_tokens: outcome.tokens.input,
      output_tokens: outcome.tokens.output,
      cache_read_tokens: outcome.tokens.cacheRead,
      cache_write_tokens: outcome.tokens.cacheWrite,
      cost_usd: cost?.total ?? null,
      input_cost_usd: cost?.input ?? null,
      output_cost_usd: cost?.output ?? null,
      cache_cost_usd: cost?.cache ?? null,
      price_version: cost ? AI_PRICE_VERSION : null,
      status: outcome.status,
      error_code: outcome.errorCode?.slice(0, 200) ?? null,
      attempt: outcome.attempt ?? 1,
      streamed: outcome.streamed,
      duration_ms: durationMs,
      first_token_ms: outcome.firstTokenMs ?? null,
      app_version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || null,
    });
    if (error) logServerError("aiUsage", "insert_failed", { feature: tag.feature, error: error.message });
  } catch (err) {
    logServerError("aiUsage", "record_failed", { feature: tag.feature, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Starts measuring one AI call. finish() records it: by default after the response has gone out; with
 * { wait: true } it resolves once the row is written (for the end of a stream, where after() is no longer available).
 */
export function beginAiUsage(tag: AiUsageTag) {
  const startedAt = Date.now();
  const context = contextStore.getStore() ?? {};
  const facts = readRequestFacts();
  let finished = false;
  return function finish(outcome: AiCallOutcome, { wait = false }: { wait?: boolean } = {}): Promise<void> {
    if (finished) return Promise.resolve();
    finished = true;
    const durationMs = Date.now() - startedAt;
    const write = async () => writeUsageRow(tag, context, await facts, outcome, durationMs);
    if (wait) return write();
    try {
      after(write);
    } catch {
      // after() is unavailable here (outside a request, or already inside an after() callback): write now, unawaited.
      void write();
    }
    return Promise.resolve();
  };
}

/** Anthropic's usage block (non-streamed response, or message_start / message_delta events). */
export function anthropicTokens(usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined | null): AiTokens {
  return {
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
  };
}

/** OpenAI's usage block: prompt_tokens includes the cached part, so it is split out to match Anthropic's meaning. */
export function openAiTokens(usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined | null): AiTokens {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { input: Math.max(0, (usage?.prompt_tokens ?? 0) - cached), output: usage?.completion_tokens ?? 0, cacheRead: cached, cacheWrite: 0 };
}

/** An aborted request (the app's own timeout) is a timeout; anything else is an error. */
export function failureOutcome(err: unknown, provider: string, model: string, streamed: boolean): AiCallOutcome {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const timeout = name === "TimeoutError" || name === "AbortError";
  const status = message.match(/\((?:openai|anthropic), (\d{3})\)/)?.[1];
  return { provider, model, tokens: NO_TOKENS, status: timeout ? "timeout" : "error", errorCode: timeout ? name : status ? `http_${status}` : message.slice(0, 120), streamed };
}
