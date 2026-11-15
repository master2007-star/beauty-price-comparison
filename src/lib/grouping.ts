/**
 * Same-product grouping.
 *
 * Two offers join one group only when they are the SAME variant of the SAME
 * product:
 *  - same Google catalog id, UNLESS their stated variant attributes
 *    conflict: both state a size and the sizes differ beyond tolerance,
 *    both state SPF and it differs, or multipacks differ. A missing
 *    size/SPF on one side does NOT split a catalog-id match — Google
 *    already identifies the product, and one store's shorter title must
 *    not fragment the group.
 *  - otherwise (no shared catalog id): same brand AND strong title
 *    overlap AND same variant signature, with strict size handling (a
 *    missing size splits; sizes must agree within tolerance, with unit
 *    normalisation: 16 fl oz == 473 ml).
 * Anything unsure splits into its own group.
 */
import { deltaLabel, formatPrice } from "./format";
import type { Offer, ProductGroup, RawOffer } from "./types";

/* ------------------------------------------------------------------ */
/* Variant extraction                                                  */
/* ------------------------------------------------------------------ */

export interface SizeInfo {
  kind: "volume" | "weight" | "count";
  /** Millilitres (volume), grams (weight), or unit count. */
  value: number;
}

const SIZE_RE =
  /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|millilitres?|milliliters?|ml|l|litres?|liters?|kilograms?|kg|grams?|g|ct|count)\b/i;

export function extractSize(title: string): SizeInfo | null {
  const m = SIZE_RE.exec(title);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = m[2].toLowerCase().replace(/\s+/g, " ").replace(/\./g, "");
  if (unit === "fl oz" || unit === "fluid ounce" || unit === "fluid ounces") {
    return { kind: "volume", value: amount * 29.5735 };
  }
  if (unit === "oz" || unit === "ounce" || unit === "ounces") {
    // Bare "oz" on beauty products is usually fluid ounces for liquids, but
    // weight ounces for solids. Treat as weight (conservative: only matches
    // other weight declarations, never a volume declaration).
    return { kind: "weight", value: amount * 28.3495 };
  }
  if (unit === "ml" || unit === "millilitre" || unit === "millilitres" || unit === "milliliter" || unit === "milliliters") {
    return { kind: "volume", value: amount };
  }
  if (unit === "l" || unit === "litre" || unit === "litres" || unit === "liter" || unit === "liters") {
    return { kind: "volume", value: amount * 1000 };
  }
  if (unit === "kg" || unit === "kilogram" || unit === "kilograms") {
    return { kind: "weight", value: amount * 1000 };
  }
  if (unit === "g" || unit === "gram" || unit === "grams") {
    return { kind: "weight", value: amount };
  }
  return { kind: "count", value: amount };
}

const MULTIPACK_RES = [
  /pack\s+of\s+(\d+)/i,
  /(\d+)\s*[-x×]\s*pack/i,
  /\(x\s*(\d+)\)/i,
  /(\d+)\s*[-x×]\s*\d+\s*(?:ml|g|oz|fl)/i,
  /\b(\d+)\s*pack\b/i,
];

export function extractMultipack(title: string): number {
  for (const re of MULTIPACK_RES) {
    const m = re.exec(title);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 1) return n;
    }
  }
  return 1;
}

export function extractSpf(title: string): number | null {
  const m = /\bspf\s*(\d{2,3})\b/i.exec(title);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

const FORM_WORDS = [
  "serum", "cream", "gel", "lotion", "oil", "spray", "balm", "mask",
  "cleanser", "wash", "shampoo", "conditioner", "toner", "moisturizer",
  "moisturiser", "mist", "stick", "drops", "foam", "scrub", "peel",
  "sunscreen", "sunblock", "lipstick", "foundation", "concealer",
  "powder", "primer", "blush", "bronzer", "highlighter", "eyeliner",
  "mascara", "perfume", "deo", "deodorant", "soap", "butter",
];

export function extractForms(title: string): Set<string> {
  const lower = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const forms = new Set<string>();
  for (const word of FORM_WORDS) {
    if (lower.includes(` ${word} `) || lower.includes(` ${word}s `)) forms.add(word);
  }
  return forms;
}

export interface VariantSignature {
  size: SizeInfo | null;
  multipack: number;
  spf: number | null;
  forms: Set<string>;
}

export function variantSignature(title: string): VariantSignature {
  return {
    size: extractSize(title),
    multipack: extractMultipack(title),
    spf: extractSpf(title),
    forms: extractForms(title),
  };
}

/** Sizes match when kinds agree and values are within 2% (or 1 unit). */
export function sizesMatch(a: SizeInfo | null, b: SizeInfo | null): boolean {
  if (!a || !b) return false; // strict: an unknown size never equals a known one
  if (a.kind !== b.kind) return false;
  const diff = Math.abs(a.value - b.value);
  const tolerance = Math.max(1, Math.min(a.value, b.value) * 0.02);
  return diff <= tolerance;
}

export function sameVariant(a: VariantSignature, b: VariantSignature): boolean {
  // Size: both missing is fine (no size stated anywhere); one missing splits.
  if ((a.size === null) !== (b.size === null)) return false;
  if (a.size && b.size && !sizesMatch(a.size, b.size)) return false;
  if (a.multipack !== b.multipack) return false;
  if (a.spf !== b.spf) return false;
  // Form: identical sets, or one side empty (unstated). Disjoint stated
  // forms (serum vs cream) split.
  if (a.forms.size > 0 && b.forms.size > 0) {
    let overlap = false;
    for (const f of a.forms) if (b.forms.has(f)) overlap = true;
    if (!overlap) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Title similarity                                                    */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "of", "in", "on", "to",
  "by", "at", "from", "new", "buy", "online", "best", "pack", "set",
]);

/**
 * First-token words that describe the product, not the brand. A title
 * starting with one of these has no identifiable brand, so brand matching
 * must not merge it with anything (catalog id can still anchor it).
 */
const GENERIC_LEAD_WORDS = new Set([
  "vitamin", "face", "skin", "hair", "body", "lip", "eye", "foot", "hand",
  "nail", "daily", "glow", "glowing", "brightening", "hydrating",
  "moisturising", "moisturizing", "nourishing", "cleansing", "refreshing",
  "soothing", "anti", "age", "ageing", "aging", "sun", "sunscreen",
  "sunblock", "men", "women", "baby", "unisex", "natural", "organic",
  "pure", "herbal", "gentle", "deep", "total", "perfect", "instant",
  "original", "classic", "advanced", "professional", "ultra", "micellar",
  "charcoal", "clay", "gold", "rose", "saffron", "aloe", "vera", "neem",
  "tea", "green", "fruit", "floral", "fresh", "clean", "clear",
  "oil", "serum", "cream", "gel", "lotion", "mask", "wash", "shampoo",
  "toner", "mist", "scrub", "peel", "balm", "soap", "powder", "spray",
  "drops", "stick", "foam", "primer", "blush", "bronzer", "mascara",
  "liner", "polish", "perfume", "deo", "deodorant", "butter", "water",
  "milk", "essence", "ampoule", "concentrate", "elixir", "treatment",
  "therapy", "care", "repair", "restore", "renew", "firming", "lifting",
  "whitening", "lightening", "fairness", "acne", "pimple", "dark", "spot",
  "pigmentation", "tan", "removal", "remover", "kit", "combo", "bundle",
  "value", "trial", "mini", "travel", "refill", "duo", "trio",
]);

export function coreTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+(\.\d+)?$/.test(t));
  return new Set(tokens);
}

/** Containment of the smaller token set inside the larger one. */
export function titleContainment(a: string, b: string): number {
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

export function extractBrand(title: string): string | null {
  const first = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")[0];
  if (!first || first.length < 2 || STOPWORDS.has(first) || GENERIC_LEAD_WORDS.has(first)) return null;
  return first;
}

export function sameBrand(a: string, b: string): boolean {
  const ba = extractBrand(a);
  const bb = extractBrand(b);
  if (!ba || !bb) return false;
  if (ba === bb) return true;
  // One brand token appearing in the other's first three tokens (e.g.
  // "CeraVe" vs "CeraVe Moisturising Cream ...").
  const head = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3);
  return head(a).includes(bb) || head(b).includes(ba);
}

/* ------------------------------------------------------------------ */
/* Clustering                                                          */
/* ------------------------------------------------------------------ */

interface PreparedOffer {
  offer: Offer;
  variant: VariantSignature;
}

/**
 * Do the two variant signatures state CONFLICTING attributes? Only
 * attributes stated on BOTH sides can conflict: a size stated on one side
 * and missing on the other is not a conflict. Used for catalog-id
 * matching, where Google has already identified the product.
 */
export function statedVariantConflict(a: VariantSignature, b: VariantSignature): boolean {
  if (a.size && b.size && !sizesMatch(a.size, b.size)) return true;
  if (a.spf !== null && b.spf !== null && a.spf !== b.spf) return true;
  if (a.multipack !== b.multipack) return true;
  return false;
}

export function offersMatch(a: PreparedOffer, b: PreparedOffer): boolean {
  // Catalog id first: Google's own product identity anchors the match.
  // Only a stated variant conflict (sizes, SPF, multipack) can split it.
  const ca = a.offer.catalogId;
  const cb = b.offer.catalogId;
  if (ca && cb && ca === cb) return !statedVariantConflict(a.variant, b.variant);
  // No shared catalog id: strict path — same variant signature, same
  // brand, strong title overlap. A missing size still splits here.
  if (!sameVariant(a.variant, b.variant)) return false;
  if (!sameBrand(a.offer.title, b.offer.title)) return false;
  return titleContainment(a.offer.title, b.offer.title) >= 0.5;
}

/** Drop exact duplicates (same store + same product + same price). */
export function dedupeOffers(offers: RawOffer[]): RawOffer[] {
  const seen = new Map<string, RawOffer>();
  for (const o of offers) {
    const key = [
      o.store.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      o.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      o.price ?? "noprice",
    ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, o);
      continue;
    }
    // Prefer the copy carrying more linkage/image data.
    const score = (x: RawOffer) =>
      (x.catalogId ? 2 : 0) + (x.productToken ? 2 : 0) + (x.productId ? 1 : 0) + (x.imageUrl ? 1 : 0) + (x.directUrl ? 1 : 0);
    if (score(o) > score(existing)) seen.set(key, o);
  }
  return [...seen.values()];
}

function toOffer(raw: RawOffer, currency: string): Offer | null {
  if (raw.price === null) return null;
  const cur = raw.currency ?? currency;
  return {
    price: raw.price,
    priceLabel: raw.priceLabel ?? formatPrice(raw.price, cur),
    currency: cur,
    store: raw.store,
    title: raw.title,
    provider: raw.provider,
    productUrl: raw.productUrl,
    directUrl: raw.directUrl,
    rating: raw.rating,
    reviews: raw.reviews,
    imageUrl: raw.imageUrl,
    catalogId: raw.catalogId,
    productId: raw.productId,
    productToken: raw.productToken,
  };
}

/** Most common currency across offers; falls back to the default. */
export function pickCurrency(offers: RawOffer[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const o of offers) {
    const c = o.currency ?? fallback;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = -1;
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export function buildGroups(rawOffers: RawOffer[], fallbackCurrency: string): ProductGroup[] {
  const currency = pickCurrency(rawOffers, fallbackCurrency);
  const priced: PreparedOffer[] = [];
  for (const raw of rawOffers) {
    const offer = toOffer(raw, currency);
    if (offer) priced.push({ offer, variant: variantSignature(offer.title) });
  }
  // Deterministic order so grouping is stable run to run.
  priced.sort((x, y) =>
    x.offer.store.localeCompare(y.offer.store) || x.offer.title.localeCompare(y.offer.title),
  );

  const clusters: PreparedOffer[][] = [];
  for (const candidate of priced) {
    let placed = false;
    for (const cluster of clusters) {
      // Match against ANY member, not just the first: one quirky first
      // title must not fragment the group. First matching cluster wins,
      // and candidate order is deterministic, so grouping stays stable.
      if (cluster.some((member) => offersMatch(candidate, member))) {
        cluster.push(candidate);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([candidate]);
  }

  const groups: ProductGroup[] = clusters.map((cluster, idx) => {
    const offers = cluster
      .map((c) => c.offer)
      .sort((a, b) => a.price - b.price || a.store.localeCompare(b.store));
    const lowest = offers[0].price;
    const highest = offers[offers.length - 1].price;
    const withFlags: Offer[] = offers.map((o, i) => ({
      ...o,
      isCheapest: i === 0,
      deltaLabel: i === 0 ? null : deltaLabel(o.price, lowest, currency),
    }));
    const stores = new Set(offers.map((o) => o.store.toLowerCase()));
    const savings = Math.round((highest - lowest) * 100) / 100;
    const bestRated = [...offers].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))[0];
    const image = offers.find((o) => o.imageUrl)?.imageUrl ?? null;
    return {
      id: `g${idx + 1}`,
      title: cluster[0].offer.title,
      imageUrl: image,
      currency,
      lowestPrice: lowest,
      lowestLabel: formatPrice(lowest, currency),
      highestPrice: highest,
      highestLabel: formatPrice(highest, currency),
      storeCount: stores.size,
      savingsLabel: formatPrice(savings, currency),
      savingsPercent: highest > 0 ? Math.round((savings / highest) * 100) : 0,
      rating: bestRated?.rating ?? null,
      reviews: bestRated?.reviews ?? null,
      offers: withFlags,
    };
  });

  groups.sort((a, b) => a.lowestPrice - b.lowestPrice);
  return groups;
}

/** Flat priced offers, lowest first, with cheapest flags per group applied. */
export function flattenOffers(groups: ProductGroup[]): Offer[] {
  const all = groups.flatMap((g) => g.offers);
  all.sort((a, b) => a.price - b.price);
  return all;
}
