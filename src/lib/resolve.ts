/**
 * Direct store-link resolution.
 *
 * Tries, in order:
 *  1. SerpApi google_product by product/catalog id (offers=true) — sellers
 *     come back in sellers_results.online_sellers.
 *  2. SearchApi google_product_offers via product_token (up to 3 tokens) —
 *     offers carry merchant.name + link + extracted_price.
 *
 * A seller only counts when the store name matches AND the price matches
 * exactly. Anything else returns null and the UI falls back honestly to
 * the Google Shopping product page.
 */
import type { AppConfig } from "./env";
import { pricesEqual, storesMatch } from "./format";
import type { ProviderId, ResolveLinksResponse } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

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

async function fetchJson(url: string, init: RequestInit): Promise<Json | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    return asRecord(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

async function viaSerpApi(
  ids: string[],
  store: string | undefined,
  price: number | undefined,
  cfg: AppConfig,
): Promise<SellerCandidate | null> {
  const key = cfg.keys.serpapi;
  if (!key) return null;
  for (const id of ids) {
    const params = new URLSearchParams({
      engine: "google_product",
      product_id: id,
      offers: "true",
      gl: cfg.region,
      hl: cfg.language,
      api_key: key,
    });
    const json = await fetchJson(`https://serpapi.com/search.json?${params}`, {});
    if (!json) continue;
    const sellers = asRecord(json.sellers_results);
    const online = asArray(sellers?.online_sellers);
    const extra = asArray(json.sellers);
    for (const item of [...online, ...extra]) {
      const r = asRecord(item);
      if (!r) continue;
      const name = asString(r.name) ?? asString(r.seller) ?? asString(r.source);
      const link = asString(r.link);
      if (!name || !link || !isMerchantUrl(link)) continue;
      const p = asNumber(r.extracted_price) ?? asNumber(r.price);
      if (store && !storesMatch(name, store)) continue;
      if (price !== undefined && p !== null && !pricesEqual(p, price)) continue;
      if (price !== undefined && p === null) continue;
      return { name, link, price: p };
    }
  }
  return null;
}

async function viaSearchApi(
  tokens: string[],
  store: string | undefined,
  price: number | undefined,
  cfg: AppConfig,
): Promise<SellerCandidate | null> {
  const key = cfg.keys.searchapi;
  if (!key) return null;
  for (const token of tokens.slice(0, 3)) {
    const params = new URLSearchParams({
      engine: "google_product_offers",
      product_token: token,
      gl: cfg.region,
      hl: cfg.language,
      api_key: key,
    });
    const json = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`, {});
    if (!json) continue;
    for (const item of asArray(json.offers)) {
      const r = asRecord(item);
      if (!r) continue;
      const merchant = asRecord(r.merchant);
      const name = asString(merchant?.name) ?? asString(r.seller);
      const link = asString(r.link);
      if (!name || !link || !isMerchantUrl(link)) continue;
      const p = asNumber(r.extracted_price);
      if (store && !storesMatch(name, store)) continue;
      if (price !== undefined && p !== null && !pricesEqual(p, price)) continue;
      if (price !== undefined && p === null) continue;
      return { name, link, price: p };
    }
  }
  return null;
}

export async function resolveDirectLink(
  req: { productId?: string; catalogId?: string; productToken?: string; productTokens?: string[]; store?: string; price?: number },
  cfg: AppConfig,
): Promise<ResolveLinksResponse> {
  const ids = [req.productId, req.catalogId].filter((v): v is string => Boolean(v));
  const tokens = [...(req.productTokens ?? []), ...(req.productToken ? [req.productToken] : [])].filter(Boolean);

  if (ids.length > 0) {
    const hit = await viaSerpApi(ids, req.store, req.price, cfg);
    if (hit) return { directUrl: hit.link, matchedStore: hit.name, source: "serpapi" satisfies ProviderId };
  }
  if (tokens.length > 0) {
    const hit = await viaSearchApi(tokens, req.store, req.price, cfg);
    if (hit) return { directUrl: hit.link, matchedStore: hit.name, source: "searchapi" satisfies ProviderId };
  }
  const reason =
    !cfg.keys.serpapi && !cfg.keys.searchapi
      ? "No link-resolution provider key is configured (SERPAPI_KEY or SEARCHAPI_KEY)."
      : "No seller matched this store and price exactly.";
  return { directUrl: null, matchedStore: null, source: null, reason };
}
