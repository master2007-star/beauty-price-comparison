/**
 * Direct store-link resolution.
 *
 * Tries, in order:
 *  1. SerpApi google_immersive_product by page_token (more_stores=true)
 *     — stores come back in product_results.stores. Verified live
 *     2026-11-16: every store `link` is a RELATIVE Google redirect
 *     path (`/goto?url=...`), NOT a merchant URL, so links are
 *     absolutized against google.com and a name-matching seller's
 *     link is resolved to its merchant destination where possible
 *     (adurl param first, else one redirect follow); when resolution
 *     fails the absolute redirect URL itself is returned, since in
 *     the user's browser it lands on the merchant's product page.
 *     This replaced the retired google_product id route, which always
 *     answered "Google Product hasn't returned any results for this
 *     query" and burned a SerpApi credit on every call; no id-based
 *     SerpApi calls are made any more.
 *  2. SearchApi google_product_offers via product_token (up to 3 tokens) —
 *     offers carry merchant.name + link + extracted_price.
 *
 * The client sends a group-wide pool of tokens (the clicked offer's own
 * first, then its group siblings'); identical values collapse to one
 * provider call each, and at most 3 tokens are tried per route. Both
 * routes match on the store name ALONE against the CLICKED offer: the
 * token already establishes product identity, and Google's cached
 * seller-listed price legitimately differs from the search-result price
 * (snapshots, discounts). Anything else returns null and the UI falls
 * back honestly to the Google Shopping product page. The no-match
 * `reason` names the failure cause per route (no keys / provider
 * failures / no sellers / no name match) without ever exposing keys,
 * tokens or URLs. Provider failures include the provider's own error
 * message, sanitized (error/message field only, 160 chars max, runs of
 * 32+ alphanumerics redacted).
 */
import type { AppConfig } from "./env";
import { pricesEqual, storesMatch } from "./format";
import type { ProviderId, ResolveLinksRequest, ResolveLinksResponse } from "./types";

const FETCH_TIMEOUT_MS = 15_000;
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
  /** The provider's own error message, sanitized (see providerErrorMessage), or null when none was readable. */
  errorMessage: string | null;
}

/**
 * The provider's error text, sanitized for diagnostics: only the
 * `error`/`message` string field is ever taken, truncated to 160 chars,
 * with any run of 32+ alphanumeric characters redacted so no key or
 * token can leak. URLs, request params and raw bodies are never included.
 */
function providerErrorMessage(obj: Json): string | null {
  const direct =
    asString(obj.error) ?? asString(asRecord(obj.error)?.message) ?? asString(obj.message);
  if (!direct) return null;
  return direct.replace(/[A-Za-z0-9]{32,}/g, "[redacted]").slice(0, 160);
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const parsed: unknown = await res.json().catch(() => null);
    const obj = asRecord(parsed);
    if (!res.ok) {
      // Non-2xx: still read a JSON error body for its message, if any.
      return { status: res.status, json: null, apiError: false, errorMessage: obj ? providerErrorMessage(obj) : null };
    }
    if (!obj) return { status: res.status, json: null, apiError: false, errorMessage: null };
    const apiError = Boolean(asString(obj.error) ?? asString(asRecord(obj.error)?.message));
    return { status: res.status, json: obj, apiError, errorMessage: providerErrorMessage(obj) };
  } catch {
    return { status: null, json: null, apiError: false, errorMessage: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Failure classification for diagnostics: status plus the provider's own sanitized error message, never keys, tokens or URLs. */
function failureDetail(outcome: FetchOutcome): string {
  const quoted = outcome.errorMessage ? `: "${outcome.errorMessage}"` : "";
  if (outcome.apiError) return `API error${quoted}`;
  if (outcome.status !== null) return `HTTP ${outcome.status}${quoted}`;
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
  /** Raw seller entries found in the responses, before any checks. */
  entriesSeen: number;
  /** Entries with a name and a link whose host is Google (redirect links, rejected by the merchant check). */
  googleRedirectLinks: number;
  /** Entries missing a usable name or link. */
  missingFields: number;
  /** Google redirect links successfully followed to a merchant URL. */
  redirectsResolved: number;
  /** Google-redirect entries whose name matched the clicked store. */
  nameMatchedRedirects: number;
  /** First seller that passed the name gate but whose price differed. */
  priceMismatch: { name: string; sellerPrice: number } | null;
  /** First seller that passed the name gate but listed no price. */
  nameMatchedNoPrice: string | null;
}

function emptyAttempt(): ProviderAttempt {
  return { requests: 0, failedRequests: 0, failures: [], sellersSeen: 0, entriesSeen: 0, googleRedirectLinks: 0, missingFields: 0, redirectsResolved: 0, nameMatchedRedirects: 0, priceMismatch: null, nameMatchedNoPrice: null };
}

function recordFailure(attempt: ProviderAttempt, detail: string) {
  attempt.failedRequests += 1;
  if (!attempt.failures.includes(detail)) attempt.failures.push(detail);
}

/**
 * The seller gate: a seller only counts when the name matches (when a
 * store gate is given) and the price matches exactly (when a price gate
 * is given). Both current routes pass the store gate only — the token
 * already establishes product identity. The optional price gate is kept
 * for the shared gate: near-misses are recorded on the attempt so a
 * future gated route's no-match reason can say why.
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

const REDIRECT_TIMEOUT_MS = 4_000;
const MAX_REDIRECT_FOLLOWS = 3;

/**
 * Immersive store links come back as RELATIVE redirect paths
 * (`/goto?url=...`) — verified live 2026-11-16. Absolutize them
 * against Google's redirector so they are usable links; reject
 * anything that is not an http(s) URL after absolutizing.
 */
function absolutizeLink(link: string): string | null {
  if (link.startsWith("//")) return `https:${link}`;
  if (link.startsWith("/")) return `https://www.google.com${link}`;
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? link : null;
  } catch {
    return null;
  }
}

/**
 * The merchant destination of a Google redirect link (e.g. an aclk
 * URL), or null. Tries the `adurl` query param first (free, no
 * network — it usually carries the destination, sometimes
 * double-encoded), then follows the redirect chain once and takes the
 * final URL. Either way the result must be an absolute http(s)
 * merchant URL, or it is rejected. Never returns a Google URL.
 */
async function resolveRedirectLink(link: string): Promise<string | null> {
  try {
    const u = new URL(link);
    const adurl = u.searchParams.get("adurl");
    if (adurl) {
      let dest = adurl;
      try { dest = decodeURIComponent(dest); } catch { /* keep single-decoded */ }
      if (isMerchantUrl(dest)) return dest;
    }
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(link, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
    });
    return isMerchantUrl(res.url) ? res.url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Immersive route: SerpApi's google_immersive_product engine, the
 * replacement for the retired google_product engine. The page_token is
 * the shopping result's immersive_product_page_token (captured at search
 * time). Per SerpApi's docs, stores come back in
 * product_results.stores[] with `name`, `link` and
 * `extracted_price`; more_stores=true returns up to 13 stores
 * instead of the default 3–5. Verified live 2026-11-16: every store
 * `link` is a Google redirect URL, so name-matching entries have
 * their link resolved to the merchant page (see
 * resolveRedirectLink) before they can match. Parsing is defensive: any top-level
 * `stores`/`sellers` array is accepted as a fallback, and the store
 * name is read from `name`/`source`/`store`. A seller matches on the
 * store name ALONE — same reasoning as the SearchApi token route: the
 * token already establishes product identity, and the seller-listed
 * price legitimately differs from the clicked offer's snapshot.
 */
async function viaSerpApiImmersive(
  tokens: string[],
  store: string | undefined,
  cfg: AppConfig,
): Promise<{ hit: SellerCandidate | null; attempt: ProviderAttempt }> {
  const attempt = emptyAttempt();
  const key = cfg.keys.serpapi;
  if (!key) return { hit: null, attempt };
  let follows = 0;
  for (const token of tokens.slice(0, MAX_TOKENS)) {
    const params = new URLSearchParams({
      engine: "google_immersive_product",
      page_token: token,
      more_stores: "true",
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
    const productResults = asRecord(outcome.json.product_results);
    const stores = asArray(productResults?.stores);
    const fallback =
      stores.length > 0 ? [] : [...asArray(outcome.json.stores), ...asArray(outcome.json.sellers)];
    const entries = [...stores, ...fallback];
    attempt.entriesSeen += entries.length;
    for (const item of entries) {
      const r = asRecord(item);
      if (!r) { attempt.missingFields += 1; continue; }
      const name = asString(r.name) ?? asString(r.source) ?? asString(r.store);
      const rawLink = asString(r.link);
      if (!name || !rawLink) { attempt.missingFields += 1; continue; }
      const link = absolutizeLink(rawLink);
      if (!link) { attempt.missingFields += 1; continue; }
      if (!isMerchantUrl(link)) {
        // Google redirect link (the norm for immersive stores): only
        // consider entries whose name matches the clicked store. Prefer
        // the resolved merchant URL, but fall back to the redirect URL
        // itself — in the user's browser it lands on the merchant's
        // product page, which is the direct-link behaviour. Server-side
        // follows often fail (Google serves bots an interstitial
        // instead of redirecting), so a failed follow must not lose a
        // name-matched seller.
        attempt.googleRedirectLinks += 1;
        if (store && !storesMatch(name, store)) continue;
        attempt.nameMatchedRedirects += 1;
        let finalUrl: string | null = null;
        if (follows < MAX_REDIRECT_FOLLOWS) {
          follows += 1;
          finalUrl = await resolveRedirectLink(link);
          if (finalUrl) attempt.redirectsResolved += 1;
        }
        const p = asNumber(r.extracted_price) ?? asNumber(r.price);
        const hit = evaluateSeller(name, finalUrl ?? link, p, store, undefined, attempt);
        if (hit) return { hit, attempt };
        continue;
      }
      const p = asNumber(r.extracted_price) ?? asNumber(r.price);
      const hit = evaluateSeller(name, link, p, store, undefined, attempt);
      if (hit) return { hit, attempt };
    }
  }
  return { hit: null, attempt };
}

/**
 * Token route: a seller matches on the store name ALONE. The token
 * already establishes product identity, and Google's cached
 * seller-listed price legitimately differs from the clicked offer's
 * search-result price, so no price gate is applied here.
 */
async function viaSearchApi(
  tokens: string[],
  store: string | undefined,
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
    const offers = asArray(outcome.json.offers);
    attempt.entriesSeen += offers.length;
    for (const item of offers) {
      const r = asRecord(item);
      if (!r) { attempt.missingFields += 1; continue; }
      const merchant = asRecord(r.merchant);
      const name = asString(merchant?.name) ?? asString(r.seller);
      const link = asString(r.link);
      if (!name || !link) { attempt.missingFields += 1; continue; }
      if (!isMerchantUrl(link)) { attempt.googleRedirectLinks += 1; continue; }
      const p = asNumber(r.extracted_price);
      const hit = evaluateSeller(name, link, p, store, undefined, attempt);
      if (hit) return { hit, attempt };
    }
  }
  return { hit: null, attempt };
}

function dedupeValues(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

/**
 * Counts-only detail for the no-sellers case: distinguishes "the
 * response had no store entries" from "entries existed but every link
 * was a Google redirect" from "entries lacked a name or link". Counts
 * only — no URLs, hosts, tokens or keys.
 */
function attemptDetail(label: string, a: ProviderAttempt): string {
  if (a.requests === 0) return "";
  const parts = [`${a.entriesSeen} seller ${a.entriesSeen === 1 ? "entry" : "entries"}`];
  if (a.googleRedirectLinks > 0) {
    parts.push(`${a.googleRedirectLinks} Google redirect link${a.googleRedirectLinks === 1 ? "" : "s"}`);
  }
  if (a.redirectsResolved > 0) {
    parts.push(`${a.redirectsResolved} redirect${a.redirectsResolved === 1 ? "" : "s"} followed to a store page`);
  }
  if (a.nameMatchedRedirects > 0) {
    parts.push(`${a.nameMatchedRedirects} name-matched redirect${a.nameMatchedRedirects === 1 ? "" : "s"}`);
  }
  if (a.missingFields > 0) {
    parts.push(`${a.missingFields} missing name/link`);
  }
  return ` ${label}: ${parts.join(", ")} across ${a.requests} request${a.requests === 1 ? "" : "s"}.`;
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
    return "No usable product token was available for the configured resolution providers.";
  }
  if (sellersSeen === 0 && failedRequests === requests) {
    return `All link-resolution requests failed (${failures.join("; ")}).`;
  }
  if (sellersSeen === 0) {
    const detail = attemptDetail("SerpApi", serpAttempt) + attemptDetail("SearchApi", searchAttempt);
    return `No sellers were returned for the tried product tokens.${detail}${failureSuffix}`;
  }
  if (req.store) {
    return `No seller named "${req.store}" among the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned.${failureSuffix}`;
  }
  return `None of the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned matched the clicked store.${failureSuffix}`;
}

export async function resolveDirectLink(
  req: ResolveLinksRequest,
  cfg: AppConfig,
): Promise<ResolveLinksResponse> {
  // Clicked offer's own tokens first, then pooled group tokens; identical
  // values collapse to a single provider call each, capped at 3 tokens
  // per route. Pooled product/catalog ids are ignored: the SerpApi
  // google_product id route is retired and every id call fails.
  const immersiveTokens = dedupeValues(req.immersiveTokens ?? []).slice(0, MAX_TOKENS);
  const tokens = dedupeValues([...(req.productTokens ?? []), req.productToken]).slice(0, MAX_TOKENS);

  let serpAttempt = emptyAttempt();
  let searchAttempt = emptyAttempt();
  if (immersiveTokens.length > 0 && cfg.keys.serpapi) {
    const r = await viaSerpApiImmersive(immersiveTokens, req.store, cfg);
    serpAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "serpapi" satisfies ProviderId };
  }
  if (tokens.length > 0 && cfg.keys.searchapi) {
    const r = await viaSearchApi(tokens, req.store, cfg);
    searchAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "searchapi" satisfies ProviderId };
  }
  return { directUrl: null, matchedStore: null, source: null, reason: noMatchReason(req, cfg, serpAttempt, searchAttempt) };
}
