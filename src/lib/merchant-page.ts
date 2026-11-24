import { isDirectProductUrl } from "./url";
const FETCH_TIMEOUT_MS = 6_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
    const h = host.toLowerCase().replace(/^\[|\]$/g, "");
    return h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
  }
  return false;
}

/** Only public http(s) URLs may be fetched. Provider data feeds the
 *  resolver, so a hostile or buggy listing must never turn this into
 *  a request against localhost, a private range, or a cloud metadata
 *  endpoint. (DNS rebinding past this check is a residual risk: the
 *  fetch layer does its own resolution.) */
export function isFetchableUrl(raw: string): boolean {
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
    // Any Google host (google.com, google.co.in, googleadservices.com,
    // googlesyndication.com): a page served from one is not a store page.
    return new URL(url).hostname.toLowerCase().includes("google");
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
export async function fetchPageText(url: string): Promise<{ html: string; finalUrl: string } | null> {
  if (!isFetchableUrl(url) || !isDirectProductUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-IN,en;q=0.9",
        "cache-control": "no-cache",
      },
    });
    if (!res.ok || !res.body) return null;
    if (isGoogleHost(res.url) || !isFetchableUrl(res.url) || !isDirectProductUrl(res.url)) return null;
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

