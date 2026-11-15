/**
 * Live-price refresh: for each compared row, resolve the store's own
 * product page through the existing link resolver and read the
 * schema.org JSON-LD Offer price from the page HTML.
 *
 * Coverage is partial by nature (verified by a spike 2026-11-16):
 * some stores serve a parseable price, others block server fetches
 * (HTTP 403) or carry no JSON-LD price at all. Every failure mode
 * degrades to "unavailable" for that one row — never an error for the
 * whole request — and the Google snapshot price stays on screen.
 *
 * Amazon.in is special-cased: its PDPs carry no JSON-LD price, but
 * the price sits in a hidden twister buybox JSON blob (verified by a
 * research fetch 2026-11-16), with the corePrice spans as fallback,
 * and SerpApi's amazon_product engine as a last resort. The Amazon
 * extractor is never applied to non-Amazon hosts.
 *
 * SSRF rules (hard): the client NEVER supplies a URL. Only a URL
 * returned by the server's own resolveDirectLink is ever fetched, and
 * only when it is a public http(s) URL. A price is only ever extracted
 * from a page whose final URL (after redirects) is a merchant host —
 * never from a Google page the redirect chain may have landed on. The
 * resolved URL itself IS returned to the client (as the warmed direct
 * link for the row), even when the price fetch fails: it is the
 * server-resolved URL only, never a client-supplied URL and never a
 * Google Shopping productUrl.
 */
import type { AppConfig } from "./env";
import { parsePriceLabel } from "./format";
import { resolveDirectLink } from "./resolve";
import type { RefreshPricesItem, RefreshPricesResult } from "./types";

const FETCH_TIMEOUT_MS = 6_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 12;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* ------------------------- JSON-LD extraction ------------------------- */

export interface JsonLdPrice {
  price: number;
  currency: string | null;
}

/** Normalise a priceCurrency value to an ISO-style code. Schema.org
 *  wants ISO 4217, but real pages sometimes use symbols or words. */
function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  if (v === "₹" || v === "RS" || v === "RS." || v === "RUPEE" || v === "RUPEES") return "INR";
  return v;
}

/** A JSON-LD price is a number or a numeric string; zero/negative and
 *  unparseable values are not prices. */
function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") return parsePriceLabel(value);
  return null;
}

function typeIncludes(node: Record<string, unknown>, wanted: string): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t.toLowerCase() === wanted.toLowerCase();
  if (Array.isArray(t)) {
    return t.some((x) => typeof x === "string" && x.toLowerCase() === wanted.toLowerCase());
  }
  return false;
}

interface PriceCandidate {
  price: number;
  currency: string | null;
}

/**
 * Walk a parsed JSON-LD value in document order, collecting Offer /
 * AggregateOffer prices. Handles top-level objects, arrays, and
 * @graph arrays (they are all just nested values). A priceCurrency
 * found on an enclosing node is inherited by offers below it, since
 * some pages declare the currency on the Product rather than the
 * Offer. An Offer's own price wins over an AggregateOffer lowPrice
 * only by document order — callers prefer INR, then first-found.
 */
function collectCandidates(node: unknown, inheritedCurrency: string | null, out: PriceCandidate[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCandidates(item, inheritedCurrency, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const rec = node as Record<string, unknown>;
  const currency = normalizeCurrency(rec.priceCurrency) ?? inheritedCurrency;
  if (typeIncludes(rec, "Offer") || typeIncludes(rec, "AggregateOffer")) {
    const price = asPositiveNumber(rec.price) ?? asPositiveNumber(rec.lowPrice);
    if (price !== null) out.push({ price, currency });
  }
  for (const value of Object.values(rec)) {
    collectCandidates(value, currency, out);
  }
}

/**
 * The live price in a store page's JSON-LD, or null when no usable
 * Offer price exists. Prefers an INR price; otherwise the first
 * candidate in document order. Never throws: malformed blocks are
 * skipped.
 */
export function extractJsonLdPrice(html: string): JsonLdPrice | null {
  const scriptRe =
    /<script[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi;
  const candidates: PriceCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    collectCandidates(parsed, null, candidates);
  }
  if (candidates.length === 0) return null;
  return candidates.find((c) => c.currency === "INR") ?? candidates[0];
}

/* ----------------------- Amazon price extraction ----------------------- */

export interface AmazonPrice {
  price: number;
  currency: string | null;
}

/**
 * The live price in an amazon.in product page, or null. Amazon PDPs
 * carry no JSON-LD price; the price sits in a hidden twister buybox
 * JSON blob:
 *   <div class="... twister-plus-buying-options-price-data">
 *     {"desktop_buybox_group_1":[{"displayPrice":"₹380.00",
 *       "priceAmount":380.0,"currencySymbol":"₹", ...}]}
 *   </div>
 * (verified by a research fetch 2026-11-16). Fallback: the
 * a-price-symbol / a-price-whole / a-price-fraction spans inside
 * corePrice_feature_div. The `priceToPay` JSON is empty — it is not
 * used. Amazon-only: the caller must check the host first; this
 * extractor must never run on a non-Amazon page. Never throws.
 */
export function extractAmazonPrice(html: string): AmazonPrice | null {
  // Primary: twister buybox JSON blob.
  try {
    const blob = /twister-plus-buying-options-price-data"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
    if (blob) {
      const parsed: unknown = JSON.parse(blob[1].trim());
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (!key.includes("_buybox_group_")) continue;
          if (!Array.isArray(value) || value.length === 0) continue;
          const entry = value[0];
          const amount =
            typeof entry === "object" && entry !== null
              ? (entry as Record<string, unknown>).priceAmount
              : undefined;
          if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
            const symbol = (entry as Record<string, unknown>).currencySymbol;
            return {
              price: Math.round(amount * 100) / 100,
              currency: symbol === "₹" ? "INR" : typeof symbol === "string" && symbol ? symbol : null,
            };
          }
          // First buybox group only: a group with no usable entry falls
          // through to the corePrice spans below.
          break;
        }
      }
    }
  } catch {
    // Malformed blob: fall through to the corePrice spans.
  }
  // Fallback: price spans inside corePrice_feature_div only.
  try {
    const marker = html.indexOf("corePrice_feature_div");
    if (marker === -1) return null;
    const section = html.slice(marker, marker + 8000);
    const wholeMatch = /a-price-whole[^>]*>\s*([\d,]+)\s*</.exec(section);
    if (!wholeMatch) return null;
    const fractionMatch = /a-price-fraction[^>]*>\s*(\d+)\s*</.exec(section);
    const whole = Number(wholeMatch[1].replace(/,/g, ""));
    const fraction = fractionMatch ? Number(`0.${fractionMatch[1]}`) : 0;
    const price = Math.round((whole + fraction) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0) return null;
    let symbol: string | null = null;
    const symbolRe = /a-price-symbol[^>]*>\s*([^<]*?)\s*</g;
    let symbolMatch: RegExpExecArray | null;
    while ((symbolMatch = symbolRe.exec(section)) !== null) {
      if (symbolMatch[1]) {
        symbol = symbolMatch[1];
        break;
      }
    }
    return { price, currency: symbol === "₹" ? "INR" : symbol };
  } catch {
    return null;
  }
}

/* --------------------------- fetch guards --------------------------- */

function isPrivateIp(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (host.includes(":")) {
    // IPv6 literal (URL.hostname strips the brackets).
    const h = host.toLowerCase();
    return h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
  }
  return false;
}

/** Only public http(s) URLs may be fetched. Provider data feeds the
 *  resolver, so a hostile or buggy listing must never turn this into
 *  a request against localhost, a private range, or a cloud metadata
 *  endpoint. (DNS rebinding past this check is a residual risk: the
 *  fetch layer does its own resolution.) */
function isFetchableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  return !isPrivateIp(host);
}

function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("google.com") || host.endsWith("google.co.in");
  } catch {
    return true;
  }
}

/**
 * Fetch a store page as HTML text, capped at MAX_BODY_BYTES (JSON-LD
 * usually sits early in the document, so a capped prefix still parses).
 * Returns the text plus the final URL after redirects, so callers can
 * check which host actually served the page. Null on any failure:
 * timeout, non-2xx, unreadable body, or a final URL that is still a
 * Google host.
 */
async function fetchPageText(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
    if (!res.ok || !res.body) return null;
    if (isGoogleHost(res.url)) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { html: new TextDecoder().decode(merged), finalUrl: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------- SerpApi Amazon fallback --------------------- */

const SERPAPI_TIMEOUT_MS = 20_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function extractAsin(url: string): string | null {
  const match = /\/dp\/([A-Z0-9]{10})\b/.exec(url);
  return match ? match[1] : null;
}

/**
 * Last-resort Amazon price via SerpApi's amazon_product engine: one
 * call per Amazon row, only when HTML extraction found nothing. The
 * ASIN comes from the resolved/final page URL (never from the client).
 * Accepts the price only when the sibling `price` string carries ₹,
 * so a wrong-currency listing is never labelled live. Null on any
 * failure, including a missing SERPAPI_KEY.
 */
async function fetchAmazonProductPrice(
  resolvedUrl: string,
  finalUrl: string,
  cfg: AppConfig,
): Promise<JsonLdPrice | null> {
  const key = cfg.keys.serpapi;
  if (!key) return null;
  // The resolved URL may be a Google redirect with no ASIN in it; the
  // final URL is the PDP that was actually fetched.
  const asin = extractAsin(finalUrl) ?? extractAsin(resolvedUrl);
  if (!asin) return null;
  const params = new URLSearchParams({
    engine: "amazon_product",
    asin,
    amazon_domain: "amazon.in",
    api_key: key,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return null;
    const parsed: unknown = JSON.parse(text);
    const obj = asRecord(parsed);
    if (!obj) return null;
    if (asString(obj.error) ?? asString(asRecord(obj.error)?.message)) return null;
    const results = asRecord(obj.product_results);
    const price = asNumber(results?.extracted_price);
    const label = asString(results?.price);
    if (price === null || price <= 0) return null;
    if (!label || !label.includes("₹")) return null;
    return { price: Math.round(price * 100) / 100, currency: "INR" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ refresh ------------------------------ */

async function refreshOne(item: RefreshPricesItem, cfg: AppConfig): Promise<RefreshPricesResult> {
  const unavailable: RefreshPricesResult = {
    key: item.key,
    status: "unavailable",
    livePrice: null,
    currency: null,
  };
  try {
    const resolved = await resolveDirectLink(
      {
        productId: item.productId,
        catalogId: item.catalogId,
        productIds: item.productIds,
        catalogIds: item.catalogIds,
        productToken: item.productToken,
        productTokens: item.productTokens,
        immersiveTokens: item.immersiveTokens,
        store: item.store,
        price: item.price,
      },
      cfg,
    );
    const url = resolved.directUrl;
    if (!url || !isFetchableUrl(url)) return unavailable;
    // The resolved link rides along with every result below, so the
    // client can open the store page without a second resolve
    // round-trip — even when the price fetch fails. It is the
    // server-resolved URL only (see the SSRF rules above).
    const warmed = { directUrl: url };
    const page = await fetchPageText(url);
    if (!page) return { ...unavailable, ...warmed };
    const found = extractJsonLdPrice(page.html);
    if (found) return { key: item.key, status: "live", livePrice: found.price, currency: found.currency, ...warmed };
    // Amazon PDPs carry no JSON-LD price: twister extraction, then the
    // SerpApi amazon_product fallback. Host-gated on the FINAL URL —
    // the Amazon extractor must never run on a non-Amazon page.
    let finalHost = "";
    try {
      finalHost = new URL(page.finalUrl).hostname.toLowerCase();
    } catch {
      finalHost = "";
    }
    if (finalHost === "amazon.in" || finalHost.endsWith(".amazon.in")) {
      const amazon = extractAmazonPrice(page.html);
      if (amazon) {
        return { key: item.key, status: "live", livePrice: amazon.price, currency: amazon.currency, ...warmed };
      }
      const viaApi = await fetchAmazonProductPrice(url, page.finalUrl, cfg);
      if (viaApi) {
        return { key: item.key, status: "live", livePrice: viaApi.price, currency: viaApi.currency, ...warmed };
      }
    }
    return { ...unavailable, ...warmed };
  } catch {
    return unavailable;
  }
}

/**
 * Refresh up to MAX_ITEMS rows in parallel. Every item gets a result;
 * anything that fails at any stage reports "unavailable" for that row
 * only. Results carry the server-resolved direct URL whenever the
 * resolver produced one, so the client can warm the row's store link.
 */
export async function refreshLivePrices(
  items: RefreshPricesItem[],
  cfg: AppConfig,
): Promise<RefreshPricesResult[]> {
  const capped = items.slice(0, MAX_ITEMS);
  const settled = await Promise.allSettled(capped.map((item) => refreshOne(item, cfg)));
  return settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : { key: capped[i].key, status: "unavailable", livePrice: null, currency: null },
  );
}
