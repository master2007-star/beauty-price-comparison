/**
 * Gemini AI (optional) — server-only. All calls to Google's Generative
 * Language API happen here, from API routes. The API key never leaves
 * the server: it is read from GEMINI_API_KEY, sent only as the documented
 * `key` query parameter, and never logged, returned, or bundled.
 *
 * Grounding rules (encoded in every prompt, not just in comments):
 *  - Gemini may only discuss products/prices that came from a real
 *    runSearch result passed to it in the prompt. It must never invent
 *    a product, a store, or a price.
 *  - General skincare knowledge is allowed but must be framed as
 *    general information, never as medical advice or a diagnosis.
 *  - Every AI-derived search goes through the existing runSearch, so
 *    the beauty guard + beauty filter always apply.
 *
 * Without GEMINI_API_KEY the UI shows no AI controls at all and the
 * API routes answer with a short "not configured" status.
 */
import type { ChatTurn, ProductGroup } from "./types";

export const MAX_ASK_MESSAGE = 500;
export const MAX_SMART_QUERY = 200;
export const MAX_HISTORY_TURNS = 6;
export const MAX_GROUNDED_GROUPS = 12;
export const GEMINI_TIMEOUT_MS = 20_000;

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isGeminiConfigured(): boolean {
  return readEnv("GEMINI_API_KEY") !== null;
}

export function geminiModel(): string {
  return readEnv("GEMINI_MODEL") ?? DEFAULT_MODEL;
}

/* ------------------------- input validation -------------------------- */

/** Trim + length-cap an ask message. Null when missing, empty, or over the cap. */
export function normalizeAskMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ASK_MESSAGE) return null;
  return trimmed;
}

/** Trim + length-cap a smart-search query. Null when missing, empty, or over the cap. */
export function normalizeSmartQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SMART_QUERY) return null;
  return trimmed;
}

/**
 * Keep only well-formed history turns ({ role: "user" | "assistant",
 * content: non-empty string, capped at 1000 chars each) and only the
 * last MAX_HISTORY_TURNS of them. Anything else is dropped, never throws.
 */
export function sanitizeHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    turns.push({ role, content: trimmed.slice(0, 1000) });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

/* ------------------------- response parsing -------------------------- */

/**
 * Extract the generated text from a generateContent response, defensively:
 * candidates[0].content.parts[].text, all text parts joined. Any missing
 * or malformed shape returns null instead of throwing.
 */
export function extractResponseText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (typeof first !== "object" || first === null) return null;
  const content = (first as { content?: unknown }).content;
  if (typeof content !== "object" || content === null) return null;
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === "object" && part !== null) {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) texts.push(text);
    }
  }
  if (texts.length === 0) return null;
  const joined = texts.join("").trim();
  return joined.length > 0 ? joined : null;
}

/** Parse model output as JSON. Null on empty input or any parse failure. */
export function parseJsonText<T>(text: string | null): T | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/* ------------------------------ prompts ------------------------------ */

const GROUNDING_RULES = [
  "RULES — follow them exactly:",
  "1. Only mention products, stores, and prices that appear in the RESULTS list below. Never invent a product, a store, or a price.",
  "2. If the RESULTS list is empty, say plainly that no matching products were found — do not suggest specific products or prices from your own knowledge.",
  "3. Prices below are Google Shopping snapshots; the store's live price may differ. Say so if you quote a price.",
  "4. You may add brief general skincare context, but keep it clearly separate from the product facts, and frame it as general information only — never as medical advice or a diagnosis.",
  "5. Keep the answer short and helpful. Do not include links, URLs, or anything that looks like a link.",
].join("\n");

function formatHistory(history: ChatTurn[]): string {
  if (history.length === 0) return "(no earlier conversation)";
  return history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n");
}

function formatGroupLine(group: ProductGroup): string {
  const rating =
    group.rating !== null ? `, rated ${group.rating}${group.reviews ? ` (${group.reviews} reviews)` : ""}` : "";
  return `- ${group.title} | ${group.storeCount} store(s) | lowest ${group.lowestLabel}, highest ${group.highestLabel}${rating}`;
}

/**
 * Classify whether the user is asking for a product. JSON-mode prompt:
 * the model must answer with {"searchQuery": string | null} only.
 */
export function buildClassifyPrompt(message: string, history: ChatTurn[]): string {
  return [
    "You classify beauty-shopping questions. Answer with JSON only: {\"searchQuery\": string | null}.",
    "If the user is asking for a product, a recommendation, a comparison, or a price, set searchQuery to a precise Google-Shopping-style product query (brand + product + variant/size when stated, no filler words, no facts the user did not state). Use the conversation history to resolve follow-ups like \"the cheaper one\" or \"what about that serum?\".",
    "If the user is asking a general skincare question with no product in mind, or chatting about something else, set searchQuery to null.",
    "Conversation history (most recent last):",
    formatHistory(history),
    `Latest user message: ${message}`,
    "JSON only, no other text.",
  ].join("\n\n");
}

/** Grounded answer prompt: the model answers ONLY from the given results. */
export function buildGroundedAnswerPrompt(message: string, history: ChatTurn[], groups: ProductGroup[]): string {
  const lines = groups.slice(0, MAX_GROUNDED_GROUPS).map(formatGroupLine);
  return [
    "You are a friendly beauty shopping assistant on a price comparison site.",
    GROUNDING_RULES,
    "Conversation history (most recent last):",
    formatHistory(history),
    `Latest user message: ${message}`,
    "RESULTS (real, live Google Shopping results — the ONLY products and prices you may mention):",
    lines.length > 0 ? lines.join("\n") : "(no results)",
  ].join("\n\n");
}

/** General skincare answer prompt: no products, no invented prices. */
export function buildGeneralAnswerPrompt(message: string, history: ChatTurn[]): string {
  return [
    "You are a friendly beauty shopping assistant on a price comparison site. Answer the user's general skincare or beauty question briefly and helpfully.",
    "RULES — follow them exactly:",
    "1. This is general information only, never medical advice or a diagnosis. If the question sounds medical (a skin condition, reaction, or persistent problem), say the user should see a dermatologist.",
    "2. Do not invent or recommend specific products, brands, stores, or prices. If the user wants a product, tell them to ask for one and you will search live prices.",
    "3. If the question is not about beauty or skincare, decline briefly and say you only help with beauty shopping.",
    "4. Do not include links, URLs, or anything that looks like a link.",
    "Conversation history (most recent last):",
    formatHistory(history),
    `Latest user message: ${message}`,
  ].join("\n\n");
}

/** Query-rewrite prompt: JSON-mode, {"rewrittenQuery": string} only. */
export function buildRewritePrompt(query: string): string {
  return [
    "Rewrite a beauty search query into a precise Google-Shopping-style product query. Answer with JSON only: {\"rewrittenQuery\": string}.",
    "RULES:",
    "1. Keep the brand, product name, and variant/size when the user stated them. Drop filler words (\"find me\", \"cheap\", \"best\", \"please\", \"for me\").",
    "2. Never add facts the user did not state: no brand, shade, size, or product the user did not mention.",
    "3. If the query is already a precise product query, return it unchanged.",
    `User query: ${query}`,
    "JSON only, no other text.",
  ].join("\n\n");
}

/* --------------------------- API transport --------------------------- */

/**
 * One generateContent call. Text mode returns the extracted text;
 * JSON mode requests application/json and returns the parsed object.
 * ANY failure (missing key, timeout, HTTP error, malformed response,
 * JSON parse failure) returns null — callers fall back gracefully and
 * the provider's raw error is never surfaced to the client.
 */
export async function callGemini(prompt: string, options?: { jsonMode?: false }): Promise<string | null>;
export async function callGemini(prompt: string, options: { jsonMode: true }): Promise<unknown>;
export async function callGemini(
  prompt: string,
  options?: { jsonMode?: boolean },
): Promise<string | unknown> {
  const key = readEnv("GEMINI_API_KEY");
  if (!key) return null;
  const jsonMode = options?.jsonMode === true;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent` +
    `?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        ...(jsonMode ? { generationConfig: { responseMimeType: "application/json" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const payload: unknown = await res.json().catch(() => null);
    const text = extractResponseText(payload);
    if (text === null) return null;
    if (!jsonMode) return text;
    return parseJsonText<unknown>(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
