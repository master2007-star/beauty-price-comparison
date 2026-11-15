/**
 * Google Shopping provider clients.
 *
 * Each function queries ONE provider and normalises its results to RawOffer.
 * Request/response formats follow each provider's published docs (checked
 * November 2026):
 *  - SerpApi:    GET serpapi.com/search?engine=google_shopping
 *  - SearchApi:  GET searchapi.io/api/v1/search?engine=google_shopping
 *  - Serper:     POST google.serper.dev/shopping (X-API-KEY header)
 *  - Searlo:     GET api.searlo.tech/api/v1/search/shopping (x-api-key header)
 *                — endpoint path follows Searlo's documented /search/* REST
 *                pattern; see README for the live-verification note.
 *
 * Providers throw plain Errors on failure; the orchestrator turns those
 * into providerErrors. Nothing here ever invents a price.
 */
import { coercePrice, detectCurrency, defaultCurrencyForRegion } from "./format";
import type { AppConfig } from "./env";
import type { ProviderId, RawOffer } from "./types";

const FETCH_TIMEOUT_MS = 20_000;

// SearchApi is the only provider whose results carry product_token values,
// and the SearchApi token route is the only proven direct-link route. When
// SearchApi is slow, a single timeout loses every token for the search, so
// fetchSearchApi alone gets one retry (see below). The delay keeps the
// retry from hammering a struggling endpoint.
const SEARCHAPI_RETRY_DELAY_MS = 1_000;

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

async function fetchJson(
  url: string,
  init: RequestInit,
  provider: ProviderId,
  retries = 0,
): Promise<Json> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEARCHAPI_RETRY_DELAY_MS));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
      }
      const parsed: unknown = JSON.parse(text);
      const obj = asRecord(parsed);
      if (!obj) throw new Error("Unexpected response shape (not a JSON object)");
      const err = asString(obj.error) ?? asString(asRecord(obj.error)?.message);
      if (err) throw new Error(err);
      return obj;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      // Only failures where the provider never answered are retryable:
      // timeouts (the abort) and network-level fetch failures. Every other
      // failure means the provider answered — HTTP error statuses
      // (429/4xx/5xx), malformed payloads, and API error fields — and must
      // surface immediately, never silently re-spend a call.
      const retryable = error.name === "AbortError" || error instanceof TypeError;
      if (retryable && attempt < retries) {
        continue;
      }
      if (error.name === "AbortError") {
        throw new Error(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable: every iteration returns, throws, or continues to a final
  // attempt that returns or throws.
  throw new Error("Unreachable fetchJson exit");
}

/** Pull a Google catalog id out of a product URL when Google embedded one. */
export function catalogIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /(?:catalogid|gpcid)[:=](\d{6,})/.exec(url);
  return m ? m[1] : null;
}

/** SearchApi product_token values are base64 JSON carrying catalogid/gpcid. */
export function catalogIdFromProductToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const obj = asRecord(JSON.parse(decoded));
    const catalogId = asString(obj?.catalogid);
    if (catalogId) return catalogId;
    const gpcid = asString(obj?.gpcid);
    return gpcid;
  } catch {
    return null;
  }
}

/**
 * Pull the immersive page token out of a `serpapi_immersive_product_api`
 * URL (its `page_token` query param) when the shopping result carries no
 * `immersive_product_page_token` field of its own.
 */
function immersiveTokenFromApiUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const token = new URL(url).searchParams.get("page_token");
    if (token) return token;
  } catch {
    // Fall through to the regex below.
  }
  const m = /[?&]page_token=([^&]+)/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Merchant-URL check, mirroring the host check in resolve.ts: returns the
 * raw value unchanged when it is an absolute http(s) URL whose host is
 * not a Google host, and null otherwise. A host counts as Google when it
 * contains "google" anywhere, which covers google.com, google.co.in,
 * googleadservices.com and googlesyndication.com. The value is never
 * constructed, rewritten or guessed — only the provider's own raw `link`
 * is ever returned.
 */
function merchantUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.toLowerCase().includes("google")) return null;
    return value;
  } catch {
    return null;
  }
}

function baseOffer(provider: ProviderId): RawOffer {
  return {
    price: null,
    priceLabel: null,
    currency: null,
    store: "",
    title: "",
    provider,
    productUrl: null,
    directUrl: null,
    rating: null,
    reviews: null,
    imageUrl: null,
    catalogId: null,
    productId: null,
    productToken: null,
    immersiveToken: null,
  };
}

/* ------------------------------------------------------------------ */
/* SerpApi                                                             */
/* ------------------------------------------------------------------ */

export async function fetchSerpApi(query: string, cfg: AppConfig): Promise<RawOffer[]> {
  const key = cfg.keys.serpapi;
  if (!key) return [];
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: cfg.region,
    hl: cfg.language,
    num: "40",
    api_key: key,
  });
  const json = await fetchJson(`https://serpapi.com/search.json?${params}`, {}, "serpapi");
  const fallback = defaultCurrencyForRegion(cfg.region);
  const offers: RawOffer[] = [];
  for (const item of asArray(json.shopping_results)) {
    const r = asRecord(item);
    if (!r) continue;
    const title = asString(r.title);
    if (!title) continue;
    const { price, label } = coercePrice(r.extracted_price, asString(r.price));
    const rawLink = asString(r.link);
    const productUrl = asString(r.product_link) ?? rawLink;
    const offer = baseOffer("serpapi");
    offer.title = title;
    offer.store = asString(r.source) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = productUrl;
    // SerpApi's `link` is the merchant's own product page (unlike
    // `product_link`, which is the Google Shopping page). Use it verbatim
    // when it is a merchant URL; otherwise the resolve/fallback path
    // applies exactly as before.
    offer.directUrl = merchantUrl(rawLink);
    offer.imageUrl = asString(r.thumbnail);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.reviews);
    offer.productId = asString(r.product_id);
    offer.catalogId = catalogIdFromUrl(productUrl);
    // The immersive page token is the page_token for SerpApi's
    // google_immersive_product engine (the replacement for the retired
    // google_product engine): it is what lets resolve-links fetch the
    // product's stores with merchant links. Fall back to the token
    // embedded in the serpapi_immersive_product_api URL when the field
    // itself is absent.
    offer.immersiveToken =
      asString(r.immersive_product_page_token) ??
      immersiveTokenFromApiUrl(asString(r.serpapi_immersive_product_api));
    offers.push(offer);
  }
  return offers;
}

/* ------------------------------------------------------------------ */
/* SearchApi.io                                                        */
/* ------------------------------------------------------------------ */

export async function fetchSearchApi(query: string, cfg: AppConfig): Promise<RawOffer[]> {
  const key = cfg.keys.searchapi;
  if (!key) return [];
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    gl: cfg.region,
    hl: cfg.language,
    num: "40",
    api_key: key,
  });
  // One retry on timeout/network failure only: SearchApi slowness loses
  // every product_token for the search, and tokens are the only proven
  // direct-link route. HTTP errors never retry (see fetchJson).
  const json = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`, {}, "searchapi", 1);
  const fallback = defaultCurrencyForRegion(cfg.region);
  const offers: RawOffer[] = [];

  for (const item of asArray(json.shopping_results)) {
    const r = asRecord(item);
    if (!r) continue;
    const title = asString(r.title);
    if (!title) continue;
    const { price, label } = coercePrice(r.extracted_price, asString(r.price));
    const productUrl = asString(r.product_link) ?? asString(r.offers_link);
    const token = asString(r.product_token);
    const offer = baseOffer("searchapi");
    offer.title = title;
    offer.store = asString(r.seller) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = productUrl;
    // SearchApi's raw `link` is the merchant's own page when it is not a
    // Google URL; use it verbatim, exactly like the sponsored ads below.
    offer.directUrl = merchantUrl(asString(r.link));
    offer.imageUrl = asString(r.thumbnail);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.reviews);
    offer.productId = asString(r.product_id);
    offer.productToken = token;
    offer.catalogId = catalogIdFromProductToken(token) ?? catalogIdFromUrl(productUrl);
    offers.push(offer);
  }

  // Sponsored listings carry the merchant's own link — keep them, marked
  // with the direct URL only when the link is not a Google redirect.
  for (const item of asArray(json.shopping_ads)) {
    const r = asRecord(item);
    if (!r) continue;
    const title = asString(r.title);
    if (!title) continue;
    const { price, label } = coercePrice(r.extracted_price, asString(r.price));
    const link = asString(r.link);
    const offer = baseOffer("searchapi");
    offer.title = title;
    offer.store = asString(r.seller) ?? asString(r.domain) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = link;
    offer.directUrl = merchantUrl(link);
    offer.imageUrl = asString(r.image);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.reviews);
    offers.push(offer);
  }
  return offers;
}

/* ------------------------------------------------------------------ */
/* Serper                                                              */
/* ------------------------------------------------------------------ */

export async function fetchSerper(query: string, cfg: AppConfig): Promise<RawOffer[]> {
  const key = cfg.keys.serper;
  if (!key) return [];
  const json = await fetchJson(
    "https://google.serper.dev/shopping",
    {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: cfg.region, hl: cfg.language, num: 40 }),
    },
    "serper",
  );
  const fallback = defaultCurrencyForRegion(cfg.region);
  const offers: RawOffer[] = [];
  for (const item of asArray(json.shopping)) {
    const r = asRecord(item);
    if (!r) continue;
    const title = asString(r.title);
    if (!title) continue;
    const label = asString(r.price);
    const { price } = coercePrice(null, label);
    const rawLink = asString(r.link);
    const offer = baseOffer("serper");
    offer.title = title;
    offer.store = asString(r.source) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = rawLink;
    // Serper's raw `link` is the merchant's own page when it is not a
    // Google URL; use it verbatim.
    offer.directUrl = merchantUrl(rawLink);
    offer.imageUrl = asString(r.imageUrl);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.ratingCount);
    offer.productId = asString(r.productId);
    offers.push(offer);
  }
  return offers;
}

/* ------------------------------------------------------------------ */
/* Searlo                                                              */
/* ------------------------------------------------------------------ */

export async function fetchSearlo(query: string, cfg: AppConfig): Promise<RawOffer[]> {
  const key = cfg.keys.searlo;
  if (!key) return [];
  const params = new URLSearchParams({
    q: query,
    gl: cfg.region,
    hl: cfg.language,
    limit: "40",
  });
  const json = await fetchJson(
    `https://api.searlo.tech/api/v1/search/shopping?${params}`,
    { headers: { "x-api-key": key } },
    "searlo",
  );
  // Defensive: Searlo's shopping payload shape is not pinned in the public
  // docs index; accept any of the plausible result-array keys.
  const items = asArray(json.shopping).length
    ? asArray(json.shopping)
    : asArray(json.results).length
      ? asArray(json.results)
      : asArray(json.products).length
        ? asArray(json.products)
        : asArray(json.organic);
  const fallback = defaultCurrencyForRegion(cfg.region);
  const offers: RawOffer[] = [];
  for (const item of items) {
    const r = asRecord(item);
    if (!r) continue;
    const title = asString(r.title);
    if (!title) continue;
    const label = asString(r.price);
    const { price } = coercePrice(r.extracted_price ?? r.priceValue, label);
    const rawLink = asString(r.link);
    const productUrl = rawLink ?? asString(r.url) ?? asString(r.product_link);
    const offer = baseOffer("searlo");
    offer.title = title;
    offer.store =
      asString(r.source) ?? asString(r.seller) ?? asString(r.store) ?? asString(r.merchant) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = productUrl;
    // Searlo's raw `link` is the merchant's own page when it is not a
    // Google URL; use it verbatim.
    offer.directUrl = merchantUrl(rawLink);
    offer.imageUrl = asString(r.image) ?? asString(r.thumbnail) ?? asString(r.imageUrl);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.reviews) ?? asNumber(r.ratingCount);
    offer.productId = asString(r.product_id) ?? asString(r.productId);
    offer.catalogId = catalogIdFromUrl(productUrl);
    offers.push(offer);
  }
  return offers;
}

/* ------------------------------------------------------------------ */
/* Fan-out                                                             */
/* ------------------------------------------------------------------ */

export const PROVIDER_FETCHERS: Record<
  ProviderId,
  (query: string, cfg: AppConfig) => Promise<RawOffer[]>
> = {
  serpapi: fetchSerpApi,
  searchapi: fetchSearchApi,
  serper: fetchSerper,
  searlo: fetchSearlo,
};
