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

async function fetchJson(url: string, init: RequestInit, provider: ProviderId): Promise<Json> {
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
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
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
    const productUrl = asString(r.product_link) ?? asString(r.link);
    const offer = baseOffer("serpapi");
    offer.title = title;
    offer.store = asString(r.source) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = productUrl;
    offer.imageUrl = asString(r.thumbnail);
    offer.rating = asNumber(r.rating);
    offer.reviews = asNumber(r.reviews);
    offer.productId = asString(r.product_id);
    offer.catalogId = catalogIdFromUrl(productUrl);
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
    api_key: key,
  });
  const json = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`, {}, "searchapi");
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
    const isGoogle = !!link && /^https?:\/\/(www\.)?google\.com\//.test(link);
    const offer = baseOffer("searchapi");
    offer.title = title;
    offer.store = asString(r.seller) ?? asString(r.domain) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = link;
    offer.directUrl = !isGoogle ? link : null;
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
    const offer = baseOffer("serper");
    offer.title = title;
    offer.store = asString(r.source) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = asString(r.link);
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
    const productUrl = asString(r.link) ?? asString(r.url) ?? asString(r.product_link);
    const offer = baseOffer("searlo");
    offer.title = title;
    offer.store =
      asString(r.source) ?? asString(r.seller) ?? asString(r.store) ?? asString(r.merchant) ?? "Unknown store";
    offer.price = price;
    offer.priceLabel = label;
    offer.currency = detectCurrency(label, fallback);
    offer.productUrl = productUrl;
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
