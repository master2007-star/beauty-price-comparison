/**
 * Merchant PDP resolution: immersive tokens, SearchApi tokens/id rescue,
 * the offer redirect, then exact title + store searches (SerpApi Shopping,
 * SerpApi web index, Searlo fallback). Google search pages are never fetched
 * as redirects or returned as store links.
 *
 * Tokens locate candidate sellers; they do not establish a retailer variant.
 * When size/shade is specified, every path validates the merchant page against
 * the required group/row variant. An unavailable or ambiguous PDP returns null
 * and the client displays "Link unavailable". Provider credentials never leave
 * the server.
 */
import type { AppConfig } from "./env";
import { storesMatch } from "./format";
import { extractBrand, hasBundleMismatch } from "./grouping";
import { fetchPageText } from "./merchant-page";
import { extractPdpTitle, hasRequiredVariant, matchesRequiredVariant, requiredVariantTitle, statedVariantsConflict } from "./variant-validation";
import type { ProviderId, ResolveLinksRequest, ResolveLinksResponse } from "./types";
import { isDirectProductUrl, sanitizeProductUrl } from "./url";

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

/**
 * Direct merchant product URL check: rejects Google URLs, store homepages,
 * and generic search pages to ensure outbound links land on the exact product.
 */
function isMerchantUrl(url: string): boolean {
  return isDirectProductUrl(url);
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
  /** Product tokens minted by the product-page rescue route. */
  tokensMinted: number;
  /** First seller that passed the name gate but whose price differed. */
  priceMismatch: { name: string; sellerPrice: number } | null;
  /** First seller that passed the name gate but listed no price. */
  nameMatchedNoPrice: string | null;
}

function emptyAttempt(): ProviderAttempt {
  return { requests: 0, failedRequests: 0, failures: [], sellersSeen: 0, entriesSeen: 0, googleRedirectLinks: 0, missingFields: 0, redirectsResolved: 0, nameMatchedRedirects: 0, tokensMinted: 0, priceMismatch: null, nameMatchedNoPrice: null };
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
async function evaluateSeller(
  name: string,
  link: string,
  price: number | null,
  store: string | undefined,
  wantedPrice: number | undefined,
  attempt: ProviderAttempt,
  wantedTitle?: string,
): Promise<SellerCandidate | null> {
  attempt.sellersSeen += 1;
  if (store && !storesMatch(name, store)) return null;
  if (store && !storesMatch(new URL(link).hostname.replace(/^www\./i, ""), cleanStoreForQuery(store))) return null;
  const validated = await validatePdpVariant(link, wantedTitle, store);
  if (!validated) return null;
  // A verified exact variant may have a stale Google snapshot price.
  // Use price bounds only when the variant itself cannot establish identity.
  if (!hasRequiredVariant(wantedTitle) && wantedPrice !== undefined && wantedPrice > 0) {
    if (price === null) {
      attempt.nameMatchedNoPrice ??= name;
      return null;
    }
    if (price > wantedPrice * 2.0 || price < wantedPrice / 2.0) {
      attempt.priceMismatch ??= { name, sellerPrice: price };
      return null;
    }
  }
  return { name, link: validated, price };
}

async function validatePdpVariant(link: string, wantedTitle?: string, store?: string): Promise<string | null> {
  if (!isMerchantUrl(link)) return null;
  if (!hasRequiredVariant(wantedTitle)) return sanitizeProductUrl(link);
  const page = await fetchPageText(link);
  if (!page) return null;
  if (store && !storesMatch(new URL(page.finalUrl).hostname.replace(/^www\./i, ""), cleanStoreForQuery(store))) return null;
  const title = extractPdpTitle(page.html, new URL(page.finalUrl).searchParams.get("item_id") ?? undefined);
  if (!title || !titleMatches(wantedTitle!, title)) return null;
  return sanitizeProductUrl(page.finalUrl);
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
 * Destination carried in a Google redirect's query params — free, no
 * network. SerpApi google_shopping links commonly arrive as
 * /url?q=<merchant PDP> (or /aclk with adurl); extracting the param
 * avoids a fetch that Google's bot interstitial would block anyway.
 * Decodes twice: Google double-encodes the destination.
 */
function destinationFromRedirectParams(u: URL): string | null {
  for (const key of ["adurl", "q", "url"]) {
    const raw = u.searchParams.get(key);
    if (!raw) continue;
    let dest = raw;
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(dest);
        if (decoded === dest) break;
        dest = decoded;
      } catch {
        break;
      }
    }
    if (isMerchantUrl(dest)) return sanitizeProductUrl(dest);
  }
  return null;
}

/**
 * The merchant destination of a Google redirect link (e.g. an aclk
 * URL), or null. Tries the destination query params first (`adurl`,
 * `q`, `url` — free, no network; they usually carry the destination,
 * sometimes double-encoded), then follows the redirect chain once
 * and takes the final URL. Either way the result must be an absolute
 * http(s) merchant URL, or it is rejected. Never returns a Google URL.
 */
async function resolveRedirectLink(link: string): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(link);
    const dest = destinationFromRedirectParams(u);
    if (dest) return dest;
  } catch {
    return null;
  }

  // Do NOT network-fetch Google search-results pages (google.com/search?...,
  // including udm=28 / ibp=oshop URLs) — a search page is a results page, not
  // a redirect, and can never yield a PDP. Only /url, /aclk, /goto (and
  // adurl-bearing) Google URLs may use the fetch fallback.
  if (u.hostname.toLowerCase().includes("google")) {
    const isRedirect =
      u.pathname.startsWith("/goto") ||
      u.pathname.includes("/aclk") ||
      u.pathname === "/url" ||
      u.pathname.startsWith("/url") ||
      u.searchParams.has("adurl");
    if (!isRedirect) return null;
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
    return isMerchantUrl(res.url) ? sanitizeProductUrl(res.url) : null;
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
  wantedPrice?: number,
  wantedTitle?: string,
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
        // consider entries whose name matches the clicked store, and
        // only when the redirect resolves to a merchant URL.
        // Server-side follows often fail (Google serves bots an
        // interstitial instead of redirecting), and an unresolved
        // redirect must never be returned as a direct link — it
        // opens Google's bot check in the user's browser and can
        // land on a different product (live Nov 2026). A failed
        // follow loses the entry, not the search: the caller falls
        // back honestly to the Google Shopping page.
        attempt.googleRedirectLinks += 1;
        if (store && !storesMatch(name, store)) continue;
        attempt.nameMatchedRedirects += 1;
        let finalUrl: string | null = null;
        if (follows < MAX_REDIRECT_FOLLOWS) {
          follows += 1;
          finalUrl = await resolveRedirectLink(link);
          if (finalUrl) attempt.redirectsResolved += 1;
        }
        // A Google redirect that could not be resolved to a merchant
        // URL is NEVER a direct link: returning it made "Go to Store"
        // open Google's bot-verification interstitial and land on a
        // different product (live Nov 2026). Skip the entry instead —
        // the caller falls back honestly to the Google Shopping page.
        if (!finalUrl) continue;
        const p = asNumber(r.extracted_price) ?? asNumber(r.price);
        const hit = await evaluateSeller(name, finalUrl, p, store, wantedPrice, attempt, wantedTitle);
        if (hit) return { hit, attempt };
        continue;
      }
      const p = asNumber(r.extracted_price) ?? asNumber(r.price);
      const hit = await evaluateSeller(name, link, p, store, wantedPrice, attempt, wantedTitle);
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
  wantedPrice?: number,
  wantedTitle?: string,
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
      const hit = await evaluateSeller(name, link, p, store, wantedPrice, attempt, wantedTitle);
      if (hit) return { hit, attempt };
    }
  }
  return { hit: null, attempt };
}

/** Fold one attempt's observations into another, so the rescue path can
 *  attribute its minted-token offers attempt to the page route in
 *  diagnostics. */
function mergeAttempts(into: ProviderAttempt, from: ProviderAttempt): void {
  into.requests += from.requests;
  into.failedRequests += from.failedRequests;
  for (const f of from.failures) {
    if (!into.failures.includes(f)) into.failures.push(f);
  }
  into.sellersSeen += from.sellersSeen;
  into.entriesSeen += from.entriesSeen;
  into.googleRedirectLinks += from.googleRedirectLinks;
  into.missingFields += from.missingFields;
  into.redirectsResolved += from.redirectsResolved;
  into.nameMatchedRedirects += from.nameMatchedRedirects;
  into.tokensMinted += from.tokensMinted;
  into.priceMismatch ??= from.priceMismatch;
  into.nameMatchedNoPrice ??= from.nameMatchedNoPrice;
}

/**
 * Rescue route: SearchApi's legacy google_product_page engine accepts
 * a product_id and returns product.product_token, which feeds the
 * offers route. This rescues groups that carry productIds but NO
 * tokens. Runs ONLY when both token pools are empty and at least one
 * pooled id exists — strictly after the token routes, never before
 * them. Tries at most ONE id (the first pooled id, clicked offer's
 * first). A minted token is handed to viaSearchApi unchanged; the
 * offers attempt is folded into the page-route attempt so diagnostics
 * show the whole rescue path under one label.
 */
async function viaSearchApiProductPage(
  ids: string[],
  store: string | undefined,
  cfg: AppConfig,
  wantedPrice?: number,
  wantedTitle?: string,
): Promise<{ hit: SellerCandidate | null; attempt: ProviderAttempt }> {
  const attempt = emptyAttempt();
  const key = cfg.keys.searchapi;
  if (!key) return { hit: null, attempt };
  const id = ids[0];
  if (!id) return { hit: null, attempt };
  const params = new URLSearchParams({
    engine: "google_product_page",
    product_id: id,
    gl: cfg.region,
    hl: cfg.language,
    api_key: key,
  });
  attempt.requests += 1;
  const outcome = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`, {});
  if (!outcome.json || outcome.apiError) {
    recordFailure(attempt, failureDetail(outcome));
    return { hit: null, attempt };
  }
  const product = asRecord(outcome.json.product);
  const token = asString(product?.product_token) ?? asString(outcome.json.product_token);
  if (!token) return { hit: null, attempt };
  attempt.tokensMinted += 1;
  const offers = await viaSearchApi([token], store, cfg, wantedPrice, wantedTitle);
  mergeAttempts(attempt, offers.attempt);
  return { hit: offers.hit, attempt };
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
  if (a.tokensMinted > 0) {
    parts.push(`${a.tokensMinted} product token${a.tokensMinted === 1 ? "" : "s"} minted`);
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
  pageAttempt: ProviderAttempt,
): string {
  if (!cfg.keys.serpapi && !cfg.keys.searchapi) {
    return "No link-resolution provider key is configured (SERPAPI_KEY or SEARCHAPI_KEY).";
  }
  const requests = serpAttempt.requests + searchAttempt.requests + pageAttempt.requests;
  const failedRequests = serpAttempt.failedRequests + searchAttempt.failedRequests + pageAttempt.failedRequests;
  const sellersSeen = serpAttempt.sellersSeen + searchAttempt.sellersSeen + pageAttempt.sellersSeen;
  const failures: string[] = [];
  if (serpAttempt.failures.length > 0) failures.push(`SerpApi: ${serpAttempt.failures.join(", ")}`);
  if (searchAttempt.failures.length > 0) failures.push(`SearchApi: ${searchAttempt.failures.join(", ")}`);
  if (pageAttempt.failures.length > 0) failures.push(`SearchApi page route: ${pageAttempt.failures.join(", ")}`);
  const failureSuffix = failures.length > 0 ? ` Some resolution requests also failed (${failures.join("; ")}).` : "";

  if (requests === 0) {
    return "No usable product token or id was available for the configured resolution providers.";
  }
  if (sellersSeen === 0 && failedRequests === requests) {
    return `All link-resolution requests failed (${failures.join("; ")}).`;
  }
  if (sellersSeen === 0) {
    const detail =
      attemptDetail("SerpApi", serpAttempt) +
      attemptDetail("SearchApi", searchAttempt) +
      attemptDetail("SearchApi page route", pageAttempt);
    return `No sellers were returned for the tried product tokens.${detail}${failureSuffix}`;
  }
  if (req.store) {
    return `No seller named "${req.store}" among the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned.${failureSuffix}`;
  }
  return `None of the ${sellersSeen} seller${sellersSeen === 1 ? "" : "s"} returned matched the clicked store.${failureSuffix}`;
}

/**
 * Conservative title comparison for the identity-free final fallback.
 * Requires substantial overlap and at least two meaningful terms so a
 * broad category result cannot be mistaken for the clicked product.
 */
export function titleMatches(wanted: string, candidate: string): boolean {
  if (!matchesRequiredVariant(wanted, candidate)) return false;
  const wantedBrand = extractBrand(wanted);
  const candidateBrand = extractBrand(candidate);
  if (wantedBrand && candidateBrand && wantedBrand !== candidateBrand &&
      !candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").includes(wantedBrand)) return false;
  if (hasBundleMismatch(wanted, candidate)) return false;

  const ignored = new Set([
    "the", "and", "for", "with", "from", "new", "best", "buy", "online",
    "skin", "blemish", "formula", "irritation", "helps", "reduces", "educes",
    "minimize", "minimizes", "pore", "appearance", "care", "daily", "pure",
    "solution", "treatment"
  ]);
  const words = (value: string) => new Set(
    value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
      .filter((word) => word.length > 1 && !ignored.has(word)),
  );
  const a = words(wanted);
  const b = words(candidate);
  if (a.size < 2 || b.size < 2) return false;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap >= 2 && overlap / Math.min(a.size, b.size) >= 0.65;
}

/**
 * Store name for the SerpApi query: drop a trailing "by <parent>"
 * clause ("Shopsy By Flipkart" -> "Shopsy") so the search targets
 * the storefront Google Shopping lists, not the parent company.
 */
function cleanStoreForQuery(store: string): string {
  const cleaned = store.replace(/\s+by\s+.*$/i, "").trim();
  return cleaned || store;
}

/** Drop descriptor fluff from the query string so shopping engines find the listing. */
function cleanTitleForQuery(title: string): string {
  const ignored = new Set([
    "skin", "blemish", "formula", "irritation", "helps", "reduces", "educes",
    "minimize", "minimizes", "pore", "appearance", "care", "daily", "pure",
    "solution", "treatment"
  ]);
  const tokens = title.split(/\s+/).filter((t) => !ignored.has(t.toLowerCase().replace(/[^a-z0-9]/g, "")));
  return tokens.length >= 2 ? tokens.join(" ") : title;
}

const MAX_REDIRECT_RESOLUTIONS = 3;

/**
 * The merchant PDP behind one exact-offer candidate's link, or null.
 * A link that is already a merchant URL passes through; a Google
 * redirect is followed to its destination (query-param extraction
 * first, one network follow as a fallback). `product_link` is tried
 * when `link` does not resolve. Every returned URL passed
 * isMerchantUrl, so the exact-PDP-only rule still holds. The budget
 * caps slow network follows (4s each) on a last-resort path.
 */
async function resolveCandidateLink(
  link: string | null,
  productLink: string | null,
  budget: { remaining: number },
): Promise<string | null> {
  for (const raw of [link, productLink]) {
    if (!raw) continue;
    const absolute = absolutizeLink(raw);
    if (!absolute) continue;
    if (isMerchantUrl(absolute)) return sanitizeProductUrl(absolute);
    if (budget.remaining <= 0) continue;
    let u: URL;
    try {
      u = new URL(absolute);
    } catch {
      continue;
    }
    if (!u.hostname.toLowerCase().includes("google")) continue;
    budget.remaining -= 1;
    const dest = await resolveRedirectLink(absolute);
    if (dest) return dest;
  }
  return null;
}

/**
 * Shared candidate matcher for the last-resort exact-offer lookups
 * (SerpApi and Searlo). A hit needs ALL of: a store name matching
 * the clicked store, a title matching the clicked offer, a link that
 * resolves to a validated direct product page, and a price within
 * 1.5x of the clicked offer. Field fallbacks cover both providers'
 * shapes (source/seller/store/merchant, link/url/product_link,
 * extracted_price/priceValue/price).
 */
async function matchExactOffer(
  items: unknown[],
  title: string,
  store: string,
  wantedPrice: number | undefined,
  budget: { remaining: number },
): Promise<SellerCandidate | null> {
  for (const item of items.slice(0, 20)) {
    const result = asRecord(item);
    if (!result) continue;
    const name =
      asString(result.source) ??
      asString(result.seller) ??
      asString(result.store) ??
      asString(asRecord(result.merchant)?.name) ??
      asString(result.merchant) ??
      (() => { try { return new URL(asString(result.link) ?? "").hostname; } catch { return null; } })();
    const candidateTitle = asString(result.title) ?? asString(result.name);
    const link = asString(result.link) ?? asString(result.url);
    const productLink = asString(result.product_link) ?? asString(result.url);
    if (!name || !candidateTitle || (!link && !productLink)) continue;
    if (!storesMatch(name, store) || !titleMatches(title, candidateTitle)) continue;
    const dest = await resolveCandidateLink(link, productLink, budget);
    if (!dest) continue;
    if (!storesMatch(new URL(dest).hostname.replace(/^www\./i, ""), cleanStoreForQuery(store))) continue;
    const validated = await validatePdpVariant(dest, title, store);
    if (!validated) continue;
    const candPrice =
      asNumber(result.extracted_price) ?? asNumber(result.priceValue) ?? asNumber(result.price);
    if (!hasRequiredVariant(title) && wantedPrice && candPrice && wantedPrice > 0) {
      if (candPrice > wantedPrice * 2.0 || candPrice < wantedPrice / 2.0) continue;
    }
    return { name, link: validated, price: candPrice };
  }
  return null;
}

/**
 * Last-resort lookup for offers from providers that supply no usable
 * product token or ID (notably some Serper/Searlo results). The query is
 * constrained to the exact offer title and merchant, and a hit is only
 * accepted when BOTH the merchant and title match and the resolved
 * link is a validated direct product page. SerpApi google_shopping
 * links are usually Google redirects (/url?q=<PDP>, /aclk,
 * /goto?url=...), not merchant URLs — the old isMerchantUrl gate on
 * the raw link dropped every such candidate, so this path could never
 * return a hit. The redirect is now resolved to its merchant
 * destination first (param extraction, no network in the common
 * case), then the merchant check applies to the destination.
 * `product_link` is tried as a second source when `link` does not
 * resolve; it is never trusted without the same gates.
 */
async function viaSerpApiExactOfferSearch(
  title: string,
  store: string,
  cfg: AppConfig,
  wantedPrice?: number,
): Promise<SellerCandidate | null> {
  const key = cfg.keys.serpapi;
  if (!key || !title.trim() || !store.trim()) return null;
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: `${cleanTitleForQuery(title)} ${cleanStoreForQuery(store)}`,
    google_domain: "google.co.in",
    gl: cfg.region,
    hl: cfg.language,
    api_key: key,
  });
  const outcome = await fetchJson(`https://serpapi.com/search.json?${params}`, {});
  if (!outcome.json || outcome.apiError) return null;
  const hit = await matchExactOffer(asArray(outcome.json.shopping_results), title, store, wantedPrice, {
    remaining: MAX_REDIRECT_RESOLUTIONS,
  });
  if (hit) return hit;
  // Token-free Shopping entries now often carry only /search?ibp=oshop
  // links. They cannot be followed to a PDP. Search the same exact offer
  // in the web index instead, then apply the same merchant/title gates.
  params.set("engine", "google");
  params.set("q", `${cleanTitleForQuery(title)} ${cleanStoreForQuery(store)}`);
  const web = await fetchJson(`https://serpapi.com/search.json?${params}`, {});
  if (!web.json || web.apiError) return null;
  return matchExactOffer(asArray(web.json.organic_results), title, store, wantedPrice, {
    remaining: MAX_REDIRECT_RESOLUTIONS,
  });
}

/**
 * Searlo fallback for the same last-resort lookup. Searlo's shopping
 * endpoint is SerpApi-shaped (title/source/link/extracted_price) and
 * its `link` is often the merchant page directly. Runs only when the
 * SerpApi attempt returns nothing — notably when SerpApi's monthly
 * quota is exhausted (HTTP 429), which would otherwise leave every
 * identity-free row unresolvable. Same gates as the SerpApi path.
 */
async function viaSearloExactOfferSearch(
  title: string,
  store: string,
  cfg: AppConfig,
  wantedPrice?: number,
): Promise<SellerCandidate | null> {
  const key = cfg.keys.searlo;
  if (!key || !title.trim() || !store.trim()) return null;
  const params = new URLSearchParams({
    q: `${cleanTitleForQuery(title)} ${cleanStoreForQuery(store)}`,
    gl: cfg.region,
    hl: cfg.language,
    limit: "20",
  });
  const outcome = await fetchJson(`https://api.searlo.tech/api/v1/search/shopping?${params}`, {
    headers: { "x-api-key": key },
  });
  if (!outcome.json || outcome.apiError) return null;
  // Defensive: Searlo's shopping payload shape is not pinned; accept
  // any of the plausible result-array keys (same order as fetchSearlo).
  const items = asArray(outcome.json.shopping).length
    ? asArray(outcome.json.shopping)
    : asArray(outcome.json.results).length
      ? asArray(outcome.json.results)
      : asArray(outcome.json.products).length
        ? asArray(outcome.json.products)
        : asArray(outcome.json.organic);
  return matchExactOffer(items, title, store, wantedPrice, {
    remaining: MAX_REDIRECT_RESOLUTIONS,
  });
}

/**
 * The merchant destination of the clicked offer's own product URL, or
 * null. A URL that is already a merchant URL is returned as-is; a
 * Google redirect (/goto, /aclk, /url, or an adurl param) is followed
 * server-side where possible. A Google Shopping product page or
 * anything unresolvable returns null — the caller then falls back
 * honestly instead of opening the redirect. Only redirect-shaped
 * URLs are ever followed, so a shopping product page never burns a
 * fetch.
 */
async function resolveOfferRedirect(productUrl: string): Promise<string | null> {
  if (isMerchantUrl(productUrl)) return sanitizeProductUrl(productUrl);
  let u: URL;
  try {
    u = new URL(productUrl);
  } catch {
    return null;
  }
  if (!u.hostname.toLowerCase().includes("google")) return null;
  const looksRedirect =
    u.pathname.startsWith("/goto") ||
    u.pathname.startsWith("/aclk") ||
    u.pathname === "/url" ||
    u.searchParams.has("adurl");
  if (!looksRedirect) return null;
  return resolveRedirectLink(productUrl);
}

export async function resolveDirectLink(
  req: ResolveLinksRequest,
  cfg: AppConfig,
): Promise<ResolveLinksResponse> {
  // Clicked offer's own tokens first, then pooled group tokens; identical
  // values collapse to a single provider call each, capped at 3 tokens
  // per route. Pooled product/catalog ids feed ONLY the SearchApi
  // product-page rescue path, which runs solely when both token pools
  // are empty: the SerpApi google_product id route is retired and every
  // id call fails, so ids are never sent to SerpApi.
  const immersiveTokens = dedupeValues(req.immersiveTokens ?? []).slice(0, MAX_TOKENS);
  const tokens = dedupeValues([...(req.productTokens ?? []), req.productToken]).slice(0, MAX_TOKENS);
  const ids = dedupeValues([
    ...(req.productIds ?? []),
    req.productId,
    ...(req.catalogIds ?? []),
    req.catalogId,
  ]);
  if (req.groupTitle && req.title && statedVariantsConflict(req.groupTitle, req.title)) {
    return { directUrl: null, matchedStore: null, source: null, reason: "The row's stated variant conflicts with the product group." };
  }
  const wantedTitle = req.groupTitle || req.title
    ? requiredVariantTitle(req.groupTitle ?? req.title!, req.title ? [req.title] : []) : undefined;

  let serpAttempt = emptyAttempt();
  let searchAttempt = emptyAttempt();
  let pageAttempt = emptyAttempt();
  if (immersiveTokens.length > 0 && cfg.keys.serpapi) {
    const r = await viaSerpApiImmersive(immersiveTokens, req.store, cfg, req.price, wantedTitle);
    serpAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "serpapi" satisfies ProviderId };
  }
  if (tokens.length > 0 && cfg.keys.searchapi) {
    const r = await viaSearchApi(tokens, req.store, cfg, req.price, wantedTitle);
    searchAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "searchapi" satisfies ProviderId };
  }
  if (immersiveTokens.length === 0 && tokens.length === 0 && ids.length > 0 && cfg.keys.searchapi) {
    const r = await viaSearchApiProductPage(ids, req.store, cfg, req.price, wantedTitle);
    pageAttempt = r.attempt;
    if (r.hit) return { directUrl: r.hit.link, matchedStore: r.hit.name, source: "searchapi" satisfies ProviderId };
  }
  // Last: the clicked offer's own product URL, when it is a Google
  // redirect (Serper/Searlo links often are). Follow it server-side
  // to the merchant page where possible; when the follow fails
  // (Google's bot interstitial), the link stays unresolved and the
  // UI says so instead of opening the redirect.
  if (req.productUrl) {
    const resolved = await resolveOfferRedirect(req.productUrl);
    const matchingStore = resolved && (!req.store || storesMatch(new URL(resolved).hostname.replace(/^www\./i, ""), cleanStoreForQuery(req.store)));
    const validated = matchingStore ? await validatePdpVariant(resolved!, wantedTitle, req.store) : null;
    if (validated) return { directUrl: validated, matchedStore: req.store ?? null, source: null };
  }
  // Last resort: only identity-free offers with both a title and store
  // can enter this path. A direct merchant PDP must pass both gates.
  // SerpApi first, Searlo as fallback when SerpApi returns nothing
  // (e.g. its monthly quota is exhausted) — without the fallback,
  // every identity-free row stays unresolvable while SerpApi is down.
  if (req.title && req.store) {
    const serpHit = await viaSerpApiExactOfferSearch(wantedTitle ?? req.title, req.store, cfg, req.price);
    if (serpHit) return { directUrl: serpHit.link, matchedStore: serpHit.name, source: "serpapi" satisfies ProviderId };
    const searloHit = await viaSearloExactOfferSearch(wantedTitle ?? req.title, req.store, cfg, req.price);
    if (searloHit) return { directUrl: searloHit.link, matchedStore: searloHit.name, source: "searlo" satisfies ProviderId };
  }
  const reason = req.title && req.store && immersiveTokens.length === 0 && tokens.length === 0 && ids.length === 0
    ? "No matching exact merchant product page was found for the title and store."
    : noMatchReason(req, cfg, serpAttempt, searchAttempt, pageAttempt);
  return { directUrl: null, matchedStore: null, source: null, reason };
}
