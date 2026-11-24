import { extractShade, extractSize, shadesMatch, sizesMatch } from "./grouping";
import { extractOndcProduct } from "./ondc-product";

/** Missing attributes are ambiguous for link resolution, unlike grouping omissions. */
export function matchesRequiredVariant(wanted: string, candidate: string): boolean {
  const size = extractSize(wanted);
  if (size && !sizesMatch(size, extractSize(candidate))) return false;
  const shade = extractShade(wanted);
  if (shade) {
    const found = extractShade(candidate);
    if (!found || !shadesMatch(shade, found)) return false;
  }
  return true;
}

export function hasRequiredVariant(title: string | undefined): boolean {
  return Boolean(title && (extractSize(title) || extractShade(title)));
}

/** Carry agreed attributes even when the representative group title omitted them. */
export function requiredVariantTitle(base: string, titles: string[]): string {
  let wanted = base;
  if (!extractSize(base)) {
    const sizes = titles.map(extractSize).filter((size) => size !== null);
    if (sizes.length && sizes.every((size) => sizesMatch(sizes[0], size))) {
      const size = sizes[0];
      wanted += ` ${size.value} ${size.kind === "volume" ? "ml" : size.kind === "weight" ? "g" : "count"}`;
    }
  }
  if (!extractShade(base)) {
    const shades = titles.map(extractShade).filter((shade) => shade !== null);
    if (shades.length && shades.every((shade) => shadesMatch(shades[0], shade))) wanted += ` Shade ${shades[0]}`;
  }
  return wanted;
}

export function statedVariantsConflict(a: string, b: string): boolean {
  const sizeA = extractSize(a), sizeB = extractSize(b);
  const shadeA = extractShade(a), shadeB = extractShade(b);
  return Boolean((sizeA && sizeB && !sizesMatch(sizeA, sizeB)) ||
    (shadeA && shadeB && !shadesMatch(shadeA, shadeB)));
}

function plainText(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

/** Primary PDP identity only; related products and recommendation titles are excluded. */
export function extractPdpTitle(html: string, itemId?: string): string | null {
  const ondc = extractOndcProduct(html, itemId);
  if (ondc) return ondc.title;
  for (const script of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(script[1]);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
      for (const node of nodes) {
        const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
        if (types.includes("Product") && typeof node.name === "string") return plainText(node.name);
      }
    } catch { /* A malformed block cannot establish variant identity. */ }
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1 && plainText(h1)) return plainText(h1);
  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:property|name)\s*=\s*["']og:title["']/i.test(meta[0])) continue;
    const title = /content\s*=\s*["']([^"']+)["']/i.exec(meta[0])?.[1];
    if (title) return plainText(title);
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return title ? plainText(title) : null;
}
