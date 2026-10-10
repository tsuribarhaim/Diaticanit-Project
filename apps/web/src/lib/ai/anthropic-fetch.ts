/** Every request to Anthropic's /messages endpoint goes through here, so one place knows how to switch extended thinking OFF.
 *
 * Older models take `thinking: { type: "disabled" }`. Sonnet 5.5 and newer refuse that with a 400 ("To turn thinking off on this model, send
 * { type: "between_tools" } instead of { type: "disabled" }") - which made every chat message fail the moment the model was switched.
 * Rather than guess from the model name alone, a request that gets exactly that answer is sent again with the value the model asks for,
 * and the model is remembered for the life of the server instance (so the retry costs one extra round trip per cold start, not per call).
 * Model names known to need it are sent right the first time. Anything else (a 400 for another reason, any other status) is returned as is. */

const modelsNeedingBetweenTools = new Set<string>();
const KNOWN_NEWER_MODEL = /^claude-(sonnet|opus)-5-([5-9]|\d{2,})/;

export async function anthropicFetch(url: string, init: RequestInit & { body: string }): Promise<Response> {
  const payload = JSON.parse(init.body) as Record<string, unknown>;
  const model = String(payload.model ?? "");
  const send = (thinkingType: "disabled" | "between_tools") => fetch(url, { ...init, body: JSON.stringify({ ...payload, thinking: { type: thinkingType } }) });

  const first = modelsNeedingBetweenTools.has(model) || KNOWN_NEWER_MODEL.test(model) ? "between_tools" : "disabled";
  const response = await send(first);
  if (response.status !== 400 || first === "between_tools") return response;

  const detail = await response.clone().text().catch(() => "");
  if (!/between_tools/.test(detail)) return response;
  modelsNeedingBetweenTools.add(model);
  return send("between_tools");
}
