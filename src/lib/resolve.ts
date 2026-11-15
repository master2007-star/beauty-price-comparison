/**
 * Direct store-link resolution.
 *
 * Tries, in order:
 *  1. SerpApi google_product by product/catalog id (offers=true) — sellers
 *     come back in sellers_results.online_sellers.
 *  2. SearchApi google_product_offers via product_token (up to 3 tokens) —
 *     offers carry merchant.name + link + extracted_price.
 *
 * The client sends a group-wide pool of ids/tokens (the clicked offer's
 * own first, then its group siblings'); identical values collapse to one
 * provider call each, and at most 4 ids and 3 tokens are tried. A seller
 * only counts when the store name matches AND the price matches exactly —
 * always against the CLICKED offer's store and price. Anything else
 * returns null and the UI falls back honestly to the Google Shopping
 * product page. The no-match `reason` names the failure cause (no keys /
 * provider failures / no sellers / no name match / price mismatch)
 * without ever exposing keys, tokens or URLs.
 */
import type { AppConfig } from "./env";
import { pricesEqual, storesMatch } from "./format";
import type { ProviderId, ResolveLinksRequest, ResolveLinksResponse } from "./types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_IDS = 4;
const MAX_TOKENS = 3;

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface FetchOutcome {
  /** HTTP status, or null when the request never completed (network error, timeout, bad JSON). */
  status: number | null;
  /** Parsed JSON object, or null when the request failed or the body was not a JSON object. */
  json: Json | null;
  /** True when the provider answered HTTP 200 with an error payload. */
  apiError: boolean;
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return { status: res.status, json: null, apiError: false };
    const parsed: unknown = await res.json().catch(() => null);
    const obj = asRecord(parsed);
    if (!obj) return { status: res.status, json: null, apiError: false };
    const apiError = Boolean(asString(obj.error) ?? asString(asRecord(obj.error)?.message));
    return { status: res.status, json: obj, apiError };
  } catch {
    return { status: null, json: null, apiError: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Failure classification for diagnostics: status only, never keys or URLs. */
function failureDetail(outcome: FetchOutcome): string {
  if (outcome.apiError) return "API error";
  if (outcome.status !== null) return `HTTP ${outcome.status}`;
  return "network/timeout";
}

function isMerchantUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !host.endsWith("google.com") && !host.endsWith("google.co.in");
  } catch {
    return false;
  }
}

interface SellerCandidate {
  name: string;
  link: string;
  price: number | null;
}

/** What one provider's attempts observed, for the diagnostic reason. */
interface ProviderAttempt {
  requests: number;
  failedRequests: number;
  /** Distinct failure details, e.g. "HTTP 500", "network/timeout", "API error". */
  failures: string[];
  /** Seller entries that passed the name/link/merchant-URL checks. */
  sellersSeen: number;
  /** First seller that passed the name gate but whose price differed. */
  priceMismatch: { name: string; sellerPrice: number } | null;
  /** First seller that passed the name gate but listed no price. */
  nameMatchedNoPrice: string | null;
}

function emptyAttempt(): ProviderAttempt {
  return { requests: 0, failedRequests: 0, failures: [], sellersSeen: 0, priceMismatch: null, nameMatchedNoPrice: null };
}

function recordFailure(attempt: ProviderAttempt, detail: string) {
  attempt.failedRequests += 1;
  if (!attempt.failures.includes(detail)) attempt.failures.push(detail);
}

/**
 * The store-name + exact-price gate, unchanged in behavior: a seller only
 * counts when the name matches (when a store gate is given) and the price
 * matches exactly (when a price gate is given). Near-misses are recorded
 * on the attempt so the no-match reason can say why.
 */
function evaluateSeller(
  name: string,
  link: string,
  price: number | null,
  store: string | undefined,
  wantedPrice: number | undefined,
  attempt: ProviderAttempt,
): SellerCandidate | null {
  attempt.sellersSeen += 1;
  if (store && !storesMatch(name, store)) return null;
  if (wantedPrice !== undefined) {
    if (price === null) {
      attempt.nameMatchedNoPrice ??= name;
      return null;
    }
    if (!pricesEqual(price, wantedPrice)) {
      attempt.priceMismatch ??= { name, sellerPrice: price };
      return null;
    }
  }
  return { name, link, price };
}

async function viaSerpApi(
  ids: string[],
  store: string | undefined,
  price: number | undefined,
  cfg: AppConfig,
): Promise<{ hit: SellerCandidate | null; attempt: ProviderAttempt }> {
  const attempt = emptyAttempt();
  const key = cfg.keys.serpapi;
  if (!key) return { hit: null, attempt };
  for (const id of ids) {
    const params = new URLSearchParams({
      engine: "google_product",
      product_id: id,
      offers: "true",
      gl: cfg.region,
      hl: cfg.language,
      api_key: key,
    });
    attempt.requests += 1;
    const outcome = await fetchJson(`https://serpapi.com/search.json?${params}`, {});
    if (!outcome.json || outcome.apiError) {
      recordFailure(attempt, failureDetail(outcome));
      continue;
    }
    const sellers = asRecord(outcome.json.sellers_results);
    const online = asArray(sellers?.online_sellers);
    const extra = asArray(outcome.json.sellers);
    for (const item of [...online, ...extra]) {
      const r = asRecord(item);
      if (!r) continue;
      const name = asString(r.name) ?? asString(r.seller) ?? asString(r.source);
      const link = asString(r.link);
      if (!name || !link || !isMerchantUrl(link)) continue;
      const p = asNumber(r.extracted_price) ?? asNumber(r.price);
      const hit = evaluateSeller(name, link, p, store, price, attempt);
      if (hit) return { hit, attempt };
    }
  }
  return { hit: null, attempt };
}

async function viaSearchApi(
  tokens: string[],
  store: string | undefined,
  price: number | undefined,
  cfg: AppConfig,
): Promise<{ hit: SellerCandidate | null; attempt: ProviderAttempt }> {
  const attempt = emptyAttempt();
  const key = cfg.keys.searchapi;
  if (!key) return { hit: null, attempt };
  for (const token of tokens.slice(0, MAX_TOKENS)) {
    const params = new URLSearchParams({
      engine: "google_product_offers",
      product_token: token,
      gl: cfg.region,
      hl: cfg.language,
      api_key: key,
    });
    attempt.requests += 1;
    const outcome = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`, {});
    if (!outcome.json || outcome.apiError) {
      recordFailure(attempt, failureDetail(outcome));
      continue;
    }
    for (const item of asArray(outcome.json.offers)) {
      const r = asRecord(item);
      if (!r) continue;
      const merchant = asRecord(r.merchant);
      const name = asString(merchant?.name) ?? asString(r.seller);
      const link = asString(r.link);
      if (!name || !link || !isMerchantUrl(link)) continue;
      const p = asNumber(r.extracted_price);
      const hit = evaluateSeller(name, link, p, store, price, attempt);
      if (hit) return { hit, attempt };
    }
  }
  return { hit: null, attempt };
}

function dedupeValues(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function noMatchReason(
  req: ResolveLinksRequest,
  cfg: AppConfig,
  serpAttempt: ProviderAttempt,
  searchAttempt: ProviderAttempt,
): string {
  if (!cfg.keys.serpapi && !cfg.keys.searchapi) {
    return "No link-resolution provider key is configured (SERPAPI_KEY or SEARCHAPI_KEY).";
  }
  const requests = serpAttempt.requests + searchAttempt.requests;
  const failedRequests = serpAttempt.failedRequests + searchAttempt.failedRequests;
  const sellersSeen = serpAttempt.sellersSeen + searchAttempt.sellersSeen;
  const failures: string[] = [];
  if (serpAttempt.failures.length > 0) failures.push(`SerpApi: ${serpAttempt.failures.join(", ")}`);
  if (searchAttempt.failures.length > 0) failures.push(`SearchApi: ${searchAttempt.failures.join(", ")}`);
  const failureSuffix = failures.length > 0 ? ` Some resolution requests also failed (${failures.join("; ")}).` : "";

  if (requests === 0) {
    return "No usable product id or token was available for the configured resolution providers.";
  }
  if (sellersSeen === 0 && failedRequests === requests) {
    return `All link-resolution requests failed (${failures.join("; ")}).`;
  }
  if (sellersSeen === 0) {
    return `No sellers were returned for the tried product ids/tokens.${failureSuffix}`;
  }
  const mismatch = serpAttempt.priceMismatch ?? searchAttempt.priceMismatch;
  if (mismatch && req.price !== undefined) {
    return `Store "${mismatch.name}" matched by name but its listed price (${mismatch.sellerPrice.toFixed(2)}) differs from the clicked offer's price (${req.price.toFixed(2)}).${failureSuffix}`;
  }
  const noPrice = serpAttempt.nameMatchedNoPrice ?? searchAttempt.nameMatchedNoPrice;
  if (noPrice && req.price !== undefined) {
    return `Store "${noPrice}" matched by name but listed no price to compare with the clicked offer's price (${req.price.toFixed(2)}).${failureSuffix}`;
  }
  if (req.store) {
    return `No seller named "${req.store}" among the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned.${failureSuffix}`;
  }
  return `None of the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned matched the clicked offer exactly.${failureSuffix}`;
}

export async function resolveDirectLink(
  req: ResolveLinksRequest,
  cfg: AppConfig,
): Promise<ResolveLinksResponse> {
  // Clicked offer's own ids first, then pooled group ids; identical values
  // collapse to a single provider call each, capped at 4 ids / 3 tokens.
  const ids = dedupeValues([req.productId, req.catalogId, ...(req.productIds ?? []), ...(req.catalogIds ?? [])]).slice(0, MAX_IDS);
  const tokens = dedupeValues([...(req.productTokens ?? []), req.productToken]).slice(0, MAX_TOKENS);

  let serpAttempt = emptyAttempt();
  let searchAttempt = emptyAttempt();
  if (ids.length > 0 && cfg.keys.serpapi) {
    const r = await viaSerpApi(ids, req.store, req.price, cfg);
    serpAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "serpapi" satisfies ProviderId };
  }
  if (tokens.length > 0 && cfg.keys.searchapi) {
    const r = await viaSearchApi(tokens, req.store, req.price, cfg);
    searchAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "searchapi" satisfies ProviderId };
  }
  return { directUrl: null, matchedStore: null, source: null, reason: noMatchReason(req, cfg, serpAttempt, searchAttempt) };
}
