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
import { resolveDirectLink, titleMatches } from "./resolve";
import { fetchPageText, isFetchableUrl } from "./merchant-page";
import { extractOndcProduct } from "./ondc-product";
import { extractPdpTitle, hasRequiredVariant, requiredVariantTitle } from "./variant-validation";
import type { RefreshPricesItem, RefreshPricesResult } from "./types";

const MAX_ITEMS = 40;

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

/**
 * Digihaat / ONDC product page price extractor:
 * Digihaat PDPs render product prices via meta property tags,
 * itemprop="price", or class-based price blocks.
 */
export function extractDigihaatPrice(html: string, itemId?: string): JsonLdPrice | null {
  try {
    // Current Digihaat uses RSC item_details.price.value, an object rather
    // than a naked JSON price. Scope to the PDP's item_id, never cart items
    // or recommendations; maximum_value is the MRP, not the selling price.
    const ondc = extractOndcProduct(html, itemId);
    if (ondc) return ondc.price !== null ? { price: ondc.price, currency: ondc.currency } : null;
    for (const script of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const parsed = JSON.parse(script[1]);
        const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
        for (const product of nodes) {
          if (!product || !typeIncludes(product, "Product")) continue;
          const candidates: PriceCandidate[] = [];
          collectCandidates(product.offers, normalizeCurrency(product.priceCurrency), candidates);
          const prices = new Set(candidates.map((candidate) => `${candidate.currency}:${candidate.price}`));
          if (prices.size === 1) return candidates[0];
          if (prices.size > 1) return null;
        }
      } catch { /* Try the next valid product block. */ }
    }
    // 1. Meta tags (standard e-commerce og:price:amount or product:price:amount)
    const metaAmount =
      /<meta\s+(?:property|name)=["'](?:product:price:amount|og:price:amount|twitter:data1)["']\s+content=["']([\d.,]+)["']/i.exec(html) ??
      /<meta\s+content=["']([\d.,]+)["']\s+(?:property|name)=["'](?:product:price:amount|og:price:amount|twitter:data1)["']/i.exec(html);
    if (metaAmount) {
      const p = parseFloat(metaAmount[1].replace(/,/g, ""));
      if (Number.isFinite(p) && p > 0) return { price: Math.round(p * 100) / 100, currency: "INR" };
    }

    // 2. itemprop="price" content
    const itemProp =
      /itemprop=["']price["']\s+content=["']([\d.,]+)["']/i.exec(html) ??
      /<[^>]+itemprop=["']price["'][^>]*>[\s₹Rs.]*([\d.,]+)/i.exec(html);
    if (itemProp) {
      const p = parseFloat(itemProp[1].replace(/,/g, ""));
      if (Number.isFinite(p) && p > 0) return { price: Math.round(p * 100) / 100, currency: "INR" };
    }

    // HTML product selling-price elements (no generic JSON price scan).
    const classPrice =
      /<(?:span|div|p)\s+class=["'][^"']*(?:product-price|selling-price|special-price|current-price|price-tag)[^"']*["'][^>]*>[\s₹Rs.]*([\d.,]+)/i.exec(html);
    if (classPrice) {
      const p = parseFloat(classPrice[1].replace(/,/g, ""));
      if (Number.isFinite(p) && p > 0) return { price: Math.round(p * 100) / 100, currency: "INR" };
    }

    return null;
  } catch {
    return null;
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
    verifiedAt: null,
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
        productUrl: item.productUrl,
        title: item.title,
        groupTitle: item.groupTitle,
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
    if (!page) {
      return { key: item.key, status: "unverified", livePrice: null, currency: null, verifiedAt: null, ...warmed };
    }
    const wantedTitle = item.groupTitle || item.title
      ? requiredVariantTitle(item.groupTitle ?? item.title!, item.title ? [item.title] : []) : undefined;
    if (hasRequiredVariant(wantedTitle)) {
      const pageTitle = extractPdpTitle(page.html, new URL(page.finalUrl).searchParams.get("item_id") ?? undefined);
      if (!pageTitle || !titleMatches(wantedTitle!, pageTitle)) {
        // The second fetch may select another variant or lose identity
        // evidence. Keep the snapshot, withhold both Live and the warmed URL.
        return { ...unavailable, status: "unverified" };
      }
    }
    let found: JsonLdPrice | null = null;
    // Amazon PDPs carry no JSON-LD price: twister extraction, then the
    // SerpApi amazon_product fallback. Host-gated on the FINAL URL —
    // the Amazon extractor must never run on a non-Amazon page.
    let finalHost = "";
    try {
      finalHost = new URL(page.finalUrl).hostname.toLowerCase();
    } catch {
      finalHost = "";
    }
    const isDigihaat = finalHost === "digihaat.in" || finalHost.endsWith(".digihaat.in");
    found = isDigihaat
      ? extractDigihaatPrice(page.html, new URL(page.finalUrl).searchParams.get("item_id") ?? undefined)
      : extractJsonLdPrice(page.html);
    if (!found && (finalHost === "amazon.in" || finalHost.endsWith(".amazon.in"))) {
      const amazon = extractAmazonPrice(page.html);
      if (amazon) {
        found = amazon;
      } else {
        const viaApi = await fetchAmazonProductPrice(url, page.finalUrl, cfg);
        if (viaApi) found = viaApi;
      }
    }

    if (found && found.price > 0) {
      // Validate extracted price against expected offer price:
      // If the page price diverges wildly (> 2.0x higher or < 0.4x lower),
      // e.g. page opened 1L at ₹1747 for a 118ml ₹362 offer, do not treat as live.
      if (item.price && item.price > 0) {
        if (found.price > item.price * 2.0 || found.price < item.price / 2.0) {
          return {
            key: item.key,
            status: "unverified",
            livePrice: null,
            currency: null,
            verifiedAt: null,
            ...warmed,
          };
        }
      }
      return {
        key: item.key,
        status: "live",
        livePrice: found.price,
        currency: found.currency ?? "INR",
        verifiedAt: new Date().toISOString(),
        ...warmed,
      };
    }

    return { key: item.key, status: "unverified", livePrice: null, currency: null, verifiedAt: null, ...warmed };
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
      : { key: capped[i].key, status: "unavailable", livePrice: null, currency: null, verifiedAt: null },
  );
}
