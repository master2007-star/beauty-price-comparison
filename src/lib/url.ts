/**
 * Merchant product URL validation and sanitization.
 *
 * Ensures outbound links point to the actual merchant product page, rather than:
 *  - Google Shopping pages or Google bot redirects (google.com, googleadservices.com)
 *  - Store homepages (e.g. store.com or store.com/)
 *  - Generic store search result pages (e.g. store.com/search?q=..., store.com/s?k=...)
 *  - Collection/category index pages without a specific product
 *
 * Also safely strips known tracking/wrapper parameters (e.g. utm_*, gclid, fbclid)
 * while preserving required product identifiers (variant, sku, id, etc.).
 */

const KNOWN_TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "gad_source",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
]);

const GENERIC_SEARCH_PATHS = [
  /^\/search(?:\/|$)/i,
  /^\/s(?:\/|$)/i,
  /^\/catalogsearch(?:\/|$)/i,
  /^\/find(?:\/|$)/i,
  /^\/shop\/search(?:\/|$)/i,
  /^\/browse(?:\/|$)/i,
  /^\/collections\/all(?:\/|$)/i,
  /^\/(?:[a-z]{2}\/)?(?:sc|category|categories|collections|blogs?|articles?|pages)(?:\/|$)/i,
];

const SEARCH_QUERY_KEYS = ["q", "query", "keyword", "k", "search", "term", "field-keywords"];

// Common path segments that strongly signal an individual product page
const PRODUCT_PATH_PATTERN =
  /(?:^|\/)(?:p|dp|product|products|item|items|goods|pd|sku|gp\/product)\b/i;

/**
 * Validates that a URL is a direct merchant product page.
 * Rejects non-HTTP(S), Google hosts, store homepages, and generic search result pages.
 */
export function isDirectProductUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  // Must be standard HTTP/HTTPS
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  // Reject any Google host (google.com, google.co.in, googleadservices, googlesyndication)
  if (!hostname || hostname.includes("google") || hostname === "localhost") return false;

  const pathname = parsed.pathname.replace(/\/+$/, "");

  // Root or empty path: store homepage
  if (!pathname || pathname === "") return false;
  // Digihaat's selected ONDC item lives in the query, not the path.
  // A bare /en/product page cannot identify any exact product/variant.
  if ((hostname === "digihaat.in" || hostname.endsWith(".digihaat.in")) &&
      /\/(?:en\/)?product$/i.test(pathname) && !parsed.searchParams.get("item_id")) return false;

  // Language/region root alone (e.g. /en, /in, /en-in, /hi) is still a homepage
  if (/^\/[a-z]{2}(?:-[a-z]{2})?$/i.test(pathname)) return false;

  // Generic search result path
  if (GENERIC_SEARCH_PATHS.some((regex) => regex.test(pathname))) {
    return false;
  }

  // Generic search query parameter present without a product path segment
  const hasSearchQuery = SEARCH_QUERY_KEYS.some((k) => parsed.searchParams.has(k));
  if (hasSearchQuery && !PRODUCT_PATH_PATTERN.test(pathname)) {
    return false;
  }

  return true;
}

/**
 * Strips known tracking parameters from a product URL without modifying
 * the product path, fragment, or essential e-commerce parameters (variant, sku, id).
 */
export function sanitizeProductUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    const toDelete: string[] = [];
    for (const key of parsed.searchParams.keys()) {
      if (KNOWN_TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
