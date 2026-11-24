/**
 * Same-product grouping.
 *
 * Two offers join one group only when they are the SAME variant of the SAME
 * product — brand, product name and stated variant must ALL agree:
 *  - same Google catalog id, UNLESS their stated variant attributes
 *    conflict: both state a size and the sizes differ beyond tolerance,
 *    both state SPF and it differs, or multipacks differ — or the
 *    titles disagree about the product itself (bundle vs single, or
 *    two different product lines; see the guards below). A missing
 *    size/SPF on one side does NOT split a catalog-id match — Google
 *    already identifies the product, and one store's shorter title must
 *    not fragment the group. Two different identified brands NEVER
 *    merge, even with a shared catalog id: a shared id across brands
 *    is a data error, not an identity.
 *  - otherwise (no shared catalog id): same brand AND strong title
 *    overlap AND same variant signature. A size stated on one side
 *    only is an omission, not a different variant — the same 30 ml
 *    serum listed with and without "30ml" in the title is one product
 *    (live Nov 2026: that split fragmented one serum into three
 *    1-store cards). Two stated sizes that differ still split, as do
 *    SPF, multipack and form conflicts. Unit normalisation applies
 *    (16 fl oz == 473 ml). A query-brand fallback lets a brand-less
 *    title join a group when the search query names the brand and at
 *    least one title carries that brand token — variant strictness
 *    still applies, and the fallback never merges two identified
 *    brands, nor a listing whose identified brand is not the query
 *    brand.
 * Two guards apply on BOTH paths (catalog-id and title-based): a shared
 * catalog id anchors the match, but it is not proof of identity when
 * the titles disagree about the product itself —
 *  - a distinctive-token guard: after dropping brand, form, size/SPF/
 *    unit, claim and stopword tokens, if EACH title keeps a significant
 *    token the other lacks (line names like "strawberry" vs "vitamin"),
 *    the pair does not merge. One-sided extras (retailer noise on one
 *    title only) still merge. Brand tokens themselves are dropped
 *    here, so brand agreement is enforced by the brand checks, not
 *    by this guard.
 *  - a bundle guard: a combo/kit/duo title never merges with a single.
 * (Live Nov 2026: a Glycolic + Niacinamide bundle shared the serum's
 * catalog id and merged into its group, because the guards never
 * touched catalog-id matching.)
 * Anything unsure splits into its own group. Non-English titles split
 * from English ones under the token guard (their native-script words
 * count as distinctive) — sameness across scripts is unverifiable, so
 * splitting is the honest outcome.
 *
 * A "saving" is only ever computed across stores: a single-store
 * group reports no saving at all, however far apart its listings'
 * prices are — a same-store price spread is not a comparison, and
 * showing "YOU SAVE 97%" for one was the fake-saving defect of
 * Nov 2026.
 *
 * Groups are ordered with multi-store groups first (lowest price within
 * each tier), so real comparisons surface before single-store listings.
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
  // "( pack 2)" — pack count written after the word. Single digit only:
  // "Pack 30ml" is a size, not a count, so a two-digit number never
  // counts here (live Nov 2026: the Nutraog 2-pack hid behind this).
  /pack\s+([2-9])\b/i,
  // "60ml 2 pc" — piece count. "1 pc" is a single (ignored by the >1 check).
  /(\d{1,2})\s*pcs?\b/i,
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
  // Size: stated sizes must agree; a size stated on one side only is
  // an omission, not a different variant — one store's shorter title
  // must not fragment the group (live Nov 2026: the same 30 ml serum
  // split into three 1-store cards because one listing omitted
  // "30ml"). Two stated sizes that differ still split.
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
  // Ingredient / active words. A title led by one names no brand —
  // "Niacinamide 10% + Zinc 1% Serum" is a product description, not a
  // brand, and treating "niacinamide" as a brand let every niacinamide
  // listing merge with every other (live Nov 2026: the 19-store
  // "Skin Support Set" card mixed ThriveCo, The Element and Minimalist
  // under a The Ordinary title). Same for extractQueryBrand: a query
  // naming only an ingredient names no brand, so the query-brand
  // fallback stays off.
  "niacinamide", "niacin", "retinol", "retinoid", "bakuchiol",
  "hyaluronic", "salicylic", "glycolic", "lactic", "mandelic", "ferulic",
  "ascorbic", "ceramide", "ceramides", "peptide", "peptides", "collagen",
  "elastin", "biotin", "keratin", "caffeine", "arbutin", "kojic",
  "azelaic", "squalane", "squalene", "panthenol", "allantoin", "urea",
  "adenosine", "glutathione", "tranexamic", "centella", "madecassoside",
  "snail", "mucin", "propolis", "honey", "shea", "cocoa", "jojoba",
  "argan", "rosehip", "aha", "bha", "pha", "zinc", "titanium",
  "tocopherol",
]);

export function coreTokens(title: string): Set<string> {
  // Normalise size spellings first: "50ml" and "50 ml" are the same
  // size, so split digit-unit boundaries before tokenising. Without
  // this, "50ml" and "50 ml" share no size token at all.
  const normalised = title
    .toLowerCase()
    .replace(/(\d)(ml|g|gm|kg|oz|fl|l)\b/g, "$1 $2");
  const tokens = normalised
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

/** How many core tokens the two titles share. */
export function sharedTokenCount(a: string, b: string): number {
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared;
}

/**
 * Title agreement for merging: containment ≥ 0.5 AND at least 3 shared
 * tokens. The count floor matters because containment alone lets a
 * near-empty title merge anywhere: "The Ordinary The Skin Support
 * Set" keeps only 3 core tokens after stopwords drop out, so sharing
 * "ordinary" + "support" with a serum title scored 0.67 and the set
 * absorbed a serum-with-pouch (live Nov 2026). Genuine same-product
 * pairs share brand + product words — at least 3 tokens — while a
 * 2-token overlap is a coincidence, not an identity.
 */
export function titlesAgree(a: string, b: string): boolean {
  return titleContainment(a, b) >= 0.5 && sharedTokenCount(a, b) >= 3;
}

/**
 * Multi-word brands whose name starts with "The": the brand token is
 * the distinctive word, not "the". Without this, "The Ordinary ..."
 * is brand-less (its first token is a stopword), so the query-brand
 * fallback merges it with ANY other brand's product — the live
 * "22 stores compared" mis-grouping of Nov 2026, where Minimalist,
 * ThriveCo, Pilgrim and The Element listings all joined one
 * The Ordinary card.
 */
const KNOWN_BRAND_PHRASES: Array<[phrase: string, token: string]> = [
  ["the ordinary", "ordinary"],
  ["the body shop", "body"],
  ["the inkey list", "inkey"],
  ["the derma co", "derma"],
  ["the face shop", "face"],
];

export function extractBrand(title: string): string | null {
  const squashed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const [phrase, token] of KNOWN_BRAND_PHRASES) {
    if (squashed === phrase || squashed.startsWith(`${phrase} `)) return token;
  }
  const tokens = squashed.split(" ");
  // Skip leading stopwords: a brand like "The Ordinary" must not be
  // brand-less just because it starts with "The".
  let i = 0;
  while (i < tokens.length && STOPWORDS.has(tokens[i])) i++;
  const first = tokens[i];
  // A digit-led first token is a percentage, a size or a count — never
  // a brand. "10% Niacinamide ..." used to extract brand "10", and
  // the sameBrand head check then matched it against every title
  // carrying "10" in its first three words (live Nov 2026: that is
  // how ThriveCo and The Element joined the Ordinary card).
  if (!first || first.length < 2 || /^\d/.test(first) || GENERIC_LEAD_WORDS.has(first)) return null;
  return first;
}

export function sameBrand(a: string, b: string): boolean {
  const ba = extractBrand(a);
  const bb = extractBrand(b);
  if (!ba || !bb) return false;
  if (ba === bb) return true;
  // One brand token appearing in the other's first three tokens (e.g.
  // a retailer-prefixed "Nykaa CeraVe ..." vs "CeraVe ..."). The
  // matched token must be at least 3 letters: a 1–2 letter token in
  // the first three words is a fragment ("la", "10"), not a brand,
  // and matching on it merges unrelated products.
  const head = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3);
  return (bb.length >= 3 && head(a).includes(bb)) || (ba.length >= 3 && head(b).includes(ba));
}

/**
 * Brand token implied by the search query: the first query token that is
 * not a stopword, not a generic lead word, longer than one character, and
 * contains no digit. Null when no token qualifies (e.g. "Vitamin C
 * serum"). Used only as a fallback for brand-less listing titles — it
 * never overrides two different identified brands.
 */
export function extractQueryBrand(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !GENERIC_LEAD_WORDS.has(t) && !/\d/.test(t));
  return tokens[0] ?? null;
}

function titleHasToken(title: string, token: string): boolean {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .includes(token);
}

/**
 * Fallback token agreement: the two titles must name exactly the same
 * product line — their significant-token sets (with the query-brand
 * token itself removed, since the brand is already established by the
 * fallback's brand conditions and the branded side's own brand token
 * is dropped by significantTokens) must be EQUAL. A subset rule is
 * not enough: a noisy branded title ("... Blemish Control & Pore
 * Minimizing Serum 30 ml") contains "control", so a brand-less
 * "Oil control serum" passed a subset check against it and the
 * 16-store g2 card re-formed (live Nov 2026). Equality blocks that
 * while still letting a truly brand-less copy through ("Niacinamide
 * 10% + Zinc 1%" vs the Ordinary serum: both {niacinamide, zinc}).
 * An omitted line word blocks too — a niacinamide serum with no zinc
 * named is not provably the niacinamide+zinc serum.
 */
function fallbackTokensAgree(aTitle: string, bTitle: string, queryBrand: string): boolean {
  const strip = (s: Set<string>) => {
    const out = new Set(s);
    out.delete(queryBrand);
    return out;
  };
  const sa = strip(significantTokens(aTitle));
  const sb = strip(significantTokens(bTitle));
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Distinctive-token + bundle guards (title-based paths only)          */
/* ------------------------------------------------------------------ */

/** Standalone unit words. Digit-led tokens (50gm, 30ml, 2x) are dropped separately. */
const UNIT_WORDS = new Set([
  "ml", "l", "litre", "litres", "liter", "liters",
  "millilitre", "millilitres", "milliliter", "milliliters",
  "fl", "oz", "ounce", "ounces", "fluid",
  "g", "gm", "gram", "grams", "kg", "kilogram", "kilograms", "mg",
  "ct", "count", "pc", "pcs", "piece", "pieces",
]);

/** Protection-rating words: SPF/PA/UV ratings never identify a product line. */
const RATING_WORDS = new Set([
  "spf", "pa", "ppd", "uv", "uva", "uvb", "uvc", "broad", "spectrum",
]);

/**
 * Generic benefit/claim/audience words that appear as retailer or
 * marketing copy and never identify a product line. Deliberately NOT
 * included: line/ingredient words (vitamin, strawberry, dragon, fruit,
 * lime, watermelon, mineral, cooling, tinted, dew, swim, sports, super,
 * bright, retinol, rose, saffron, charcoal, ...) — those stay
 * significant so different lines split.
 */
const CLAIM_WORDS = new Set([
  // Protection / testing claims
  "protection", "protect", "protective", "protects", "defence", "defense",
  "tested", "testing", "vivo", "dermatologically", "dermatologist",
  "clinically", "clinical", "proven", "approved", "certified",
  "hypoallergenic", "noncomedogenic", "comedogenic",
  // Finish / feel
  "white", "cast", "waterlight", "light", "lightweight", "greasy",
  "sticky", "matte", "dewy", "sheer", "invisible", "transparent",
  "intense", "intensive", "rich", "airy", "whipped", "velvet", "silky",
  "smooth", "quick", "fast", "absorbing", "long", "lasting",
  // "Free from" claims
  "fragrance", "paraben", "sulphate", "sulfate", "alcohol", "dye",
  "cruelty", "vegan", "free", "no", "not", "without", "non",
  // Generic benefit descriptors
  "glowing", "glow", "radiant", "radiance", "brightening", "brighten",
  "even", "toned", "tone", "firming", "lifting", "tightening",
  "hydrating", "hydrate", "moisturizing", "nourishing", "nourish",
  "soothing", "soothe", "refreshing", "refresh", "calming",
  "whitening", "lightening", "fairness", "dark", "spot", "pigmentation",
  // "acne" is deliberately NOT here: it is a line word (Cetaphil Gentle
  // Acne Cleanser is its own line), and dropping it left that line with
  // no significant token at all, so the distinctive-token guard could
  // never split it from any other Cetaphil line (live Nov 2026).
  // "pimple" stays dropped: same word class, but no live title in this
  // data names a line with it.
  "pimple", "tan", "removal", "remover", "anti", "ageing",
  "aging", "wrinkle", "repair", "repairing", "restore", "restoring",
  "renew", "renewal", "rejuvenating", "care", "therapy", "treatment",
  // Audience / skin-type noise. "gentle" is deliberately NOT here: it
  // is a line word (Cetaphil Gentle Skin Cleanser), and dropping it left
  // that line with no significant token at all, so the distinctive-token
  // guard could never split it from the Foaming Cream Cleanser line
  // (live Nov 2026).
  "skin", "types", "type", "all", "sun", "daily", "everyday",
  "mild", "sensitive", "normal", "oily", "dry", "combination",
  "men", "women", "woman", "baby", "babies", "kids", "kid", "unisex",
  // Generic marketing / retailer noise
  "new", "original", "classic", "advanced", "professional", "ultra",
  "perfect", "total", "instant", "maximum", "max", "extra", "deep",
  "clean", "clear", "fresh", "pure", "natural", "organic", "herbal",
  "value", "trial", "mini", "travel", "refill", "sample", "samples",
  "tester", "online", "buy", "best", "shop", "shopping", "store",
  "official", "authentic", "genuine", "product",
  // Price / purchase noise — never a product line. Without these, a
  // brand-less title carrying "best price" fails the fallback's
  // significant-token equality against the clean branded title.
  "price", "prices", "offer", "offers", "discount", "discounts", "deal",
  "deals", "sale", "mrp", "delivery", "shipping", "order", "orders",
  "cheap", "cheapest", "lowest", "taxes", "inclusive", "emi", "cod",
  "seller", "sellers",
  // Form-like product words not in FORM_WORDS
  "essence", "elixir", "concentrate", "ampoule", "milk", "water", "blue",
]);

/** Every token class that carries no product-line identity. */
const GENERIC_DROP = new Set<string>([
  ...FORM_WORDS,
  ...UNIT_WORDS,
  ...RATING_WORDS,
  ...CLAIM_WORDS,
]);

function isDroppedToken(t: string): boolean {
  if (STOPWORDS.has(t) || GENERIC_DROP.has(t)) return true;
  // Plural forms: sunscreens, spots, types, parabens.
  if (t.endsWith("s") && GENERIC_DROP.has(t.slice(0, -1))) return true;
  return false;
}

/**
 * Tokens that identify the product line: brand, form, size/SPF/unit,
 * claim, stopword and 1-char tokens removed. Tokenisation is Unicode
 * aware (\p{L}\p{M} keeps native-script words whole), so a non-English
 * title keeps its own significant tokens and splits from an English
 * title — sameness across scripts is unverifiable. UK/US spelling
 * variants (-ise/-ize, -our/-or) are normalised so the same product
 * listed with different spellings still merges.
 */

/** Skincare abbreviations that name the same ingredient as the spelled-out form. */
const ABBREV: Record<string, string> = { sa: "salicylic" };

export function significantTokens(title: string): Set<string> {
  const brand = extractBrand(title);
  const out = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^\p{L}\p{M}\p{N}%]+/u)) {
    if (raw.length <= 1) continue;
    if (/^\d/.test(raw)) continue; // sizes/quantities: 50gm, 30ml, 2x, 10%
    if (/^spf\d*$/.test(raw)) continue; // spf50 written without a space
    let t = raw
      .replace(/ising$/, "izing")
      .replace(/ise$/, "ize")
      .replace(/ourite$/, "orite")
      .replace(/our$/, "or");
    // "SA" is salicylic acid in skincare: "Gentle Exfoliating Sa
    // Cleanser" is the same product as "Gentle Exfoliating Salicylic
    // Acid Cleanser". Without this, the token guard sees "sa" and
    // "salicylic" + "acid" as different lines and splits one product
    // (live Nov 2026: the DMart spelled-out title would split from the
    // 1mg "Sa" title under the new seed check below).
    t = ABBREV[t] ?? t;
    if (t === brand) continue;
    if (isDroppedToken(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * True when EACH title keeps at least one significant token the other
 * lacks — the titles name different product lines, so they must not
 * merge. One-sided extras (noise on one title only) do not fire the
 * guard. A title with no significant tokens at all never fires it
 * either: it carries no line identity to conflict with.
 */
export function hasDistinctiveTokens(a: string, b: string): boolean {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  let aOnly = false;
  let bOnly = false;
  for (const t of ta) if (!tb.has(t)) aOnly = true;
  for (const t of tb) if (!ta.has(t)) bOnly = true;
  return aOnly && bOnly;
}

/**
 * Bundle/kit signals: multi-item packs, never a single product.
 * Bare "set" counts — "Skin Support Set" is a set even without "of"
 * (live Nov 2026: the set title absorbed single serums because the old
 * regex required "set of"). Bare "pack" counts too, except "Pack of 1",
 * which is explicitly a single unit. "Pouch" counts: a serum sold with
 * a pouch is a different SKU from the serum alone.
 */
const BUNDLE_RES = [
  /\b(combo|bundle|kit|duo|trio|value\s+pack|set|pouch)\b/i,
  /\bpack\s+of\s+(?!1\b)\d+/i,
  /\bpack\b(?!\s+of\b)/i,
];

/** Body-part words: an "&" between two of these names one product, not two. */
const BODY_PART_WORDS = new Set([
  "face", "body", "hair", "hand", "hands", "foot", "feet",
  "lip", "lips", "cheek", "cheeks",
]);

/**
 * "&"-joined two-product titles: "Cleanser 125 Ml & Moisturising
 * Cream 80 Gm", "Cleanser Pump & Moisturizing Lotion Pump" (live
 * Nov 2026: both sat inside the Cetaphil catch-all because no
 * combo/kit/duo word was present). An "&" counts only when it joins
 * two product phrases — two size mentions, or two distinct form
 * words. It does NOT count for:
 *  - "Face & Body Wash" / "Face Wash & Body Wash": the "&" joins two
 *    body parts, or two phrases of the same form — one product whose
 *    name spans the "&".
 *  - "Blemish Control & Pore Minimizing Serum": one serum, one form.
 *  - "2-in-1 ..." products: one bottle, two functions.
 * "+" is deliberately NOT treated the same way: "Vitamin C + E" /
 * "Niacinamide 10% + Zinc 1%" join ingredients, not products.
 */
function isAmpersandBundle(title: string): boolean {
  const amp = title.indexOf("&");
  if (amp === -1) return false;
  // One bottle, two functions — never a bundle.
  if (/\b2\s*-?\s*in\s*-?\s*1\b/i.test(title) || /\btwo in one\b/i.test(title)) return false;
  // Two size mentions joined by "&" = two products, whatever the words say.
  const sizeMentions =
    title.match(/\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|millilitres?|milliliters?|ml|litres?|liters?|l|kilograms?|kg|grams?|gms?|gm|g|ct|count)\b/gi) ?? [];
  if (sizeMentions.length >= 2) return true;
  const beforeWords = title
    .slice(0, amp)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const afterWords = title
    .slice(amp + 1)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const before = beforeWords[beforeWords.length - 1];
  const after = afterWords[0];
  // "Face & Body Wash": the "&" joins two body parts, not two products.
  if (before && after && BODY_PART_WORDS.has(before) && BODY_PART_WORDS.has(after)) return false;
  // "Face Wash & Body Wash": the "&" joins two phrases of the SAME form
  // (one product type named for two body parts) — not two products.
  const formsBefore = beforeWords.filter((w) => FORM_WORDS.includes(w));
  const formsAfter = afterWords.filter((w) => FORM_WORDS.includes(w));
  if (
    formsBefore.length > 0 &&
    formsAfter.length > 0 &&
    formsBefore[formsBefore.length - 1] === formsAfter[0]
  ) {
    return false;
  }
  return extractForms(title).size >= 2;
}

export function isBundleTitle(title: string): boolean {
  return BUNDLE_RES.some((re) => re.test(title)) || isAmpersandBundle(title);
}

/** True when exactly one title is a bundle — a kit never merges with a single. */
export function hasBundleMismatch(a: string, b: string): boolean {
  return isBundleTitle(a) !== isBundleTitle(b);
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

/**
 * Line agreement between a candidate and a cluster's seed (its first
 * member, which defines the cluster's line). The old join rule only
 * required the candidate to match ANY member, so a plain title with
 * no line words of its own ("Cetaphil Gentle Skin Cleanser" keeps
 * only {gentle}) bridged every Cetaphil line into one catch-all:
 * each line matched the plain member one-sidedly, and the token
 * guard never fired on a one-sided pair (live Nov 2026).
 *
 * A candidate may join only if it names nothing new vs the seed, or
 * shares at least two line words with the seed, or states the same
 * size as the seed. Either side with no line words at all cannot
 * disagree. Bundle-to-bundle joins skip this check: bundles match by
 * bundle identity + variant (size/multipack), not by line tokens —
 * the bundle guard and the veto already constrain them, and a noisy
 * bundle title ("... Pack Of 2 At Nykaa, Best Beauty Products ...")
 * would otherwise be blocked from its own bundle group by retailer
 * noise tokens.
 */
export function seedLineAgrees(candidate: PreparedOffer, seed: PreparedOffer): boolean {
  if (isBundleTitle(candidate.offer.title) && isBundleTitle(seed.offer.title)) return true;
  const sc = significantTokens(seed.offer.title);
  const cc = significantTokens(candidate.offer.title);
  if (sc.size === 0 || cc.size === 0) return true;
  if ([...cc].every((t) => sc.has(t))) return true;
  let shared = 0;
  for (const t of cc) if (sc.has(t)) shared++;
  if (shared >= 2) return true;
  const cs = candidate.variant.size;
  const ss = seed.variant.size;
  if (cs && ss && sizesMatch(cs, ss)) return true;
  return false;
}

/**
 * A sized listing joining a size-less-seeded cluster must name the
 * seed's line in full. Without this, a size-stated listing is
 * absorbed into whichever size-less cluster it matches one-sidedly:
 * the 118 ml Gentle Skin Cleanser joined the Exfoliating cluster
 * (its {gentle} is a subset of the seed's tokens), anchored it at
 * 118 ml, and the clean 118 ml group disappeared (live Nov 2026).
 * Bundle-to-bundle joins skip this check (see seedLineAgrees).
 */
export function sizeLineOk(candidate: PreparedOffer, seed: PreparedOffer): boolean {
  if (isBundleTitle(candidate.offer.title) && isBundleTitle(seed.offer.title)) return true;
  if (candidate.variant.size === null || seed.variant.size !== null) return true;
  const sc = significantTokens(seed.offer.title);
  const cc = significantTokens(candidate.offer.title);
  return [...sc].every((t) => cc.has(t));
}

export function offersMatch(a: PreparedOffer, b: PreparedOffer, queryBrand: string | null = null): boolean {
  // Catalog id first: Google's own product identity anchors the match.
  // A stated variant conflict (sizes, SPF, multipack) can split it,
  // and so can the bundle / distinctive-token guards: a shared id is
  // not proof of identity when the titles name a bundle vs a single,
  // or two different product lines. Two different identified brands
  // NEVER merge, even with a shared catalog id: a shared id across
  // brands is a data error, not an identity.
  const ca = a.offer.catalogId;
  const cb = b.offer.catalogId;
  if (ca && cb && ca === cb) {
    const ba = extractBrand(a.offer.title);
    const bb = extractBrand(b.offer.title);
    if (ba && bb && ba !== bb) return false;
    // The guards apply here too: a shared catalog id anchors the
    // match, but it is not proof of identity when the titles name a
    // bundle vs a single, or two different product lines (live
    // Nov 2026: a Glycolic + Niacinamide bundle shared the serum's
    // catalog id and merged into its group).
    if (hasBundleMismatch(a.offer.title, b.offer.title)) return false;
    if (hasDistinctiveTokens(a.offer.title, b.offer.title)) return false;
    return !statedVariantConflict(a.variant, b.variant);
  }
  // No shared catalog id: strict path — same variant signature, same
  // brand, strong title overlap. A size stated on one side only is an
  // omission, not a conflict (see sameVariant).
  if (!sameVariant(a.variant, b.variant)) return false;
  // Guards for the title-based paths only: different product lines and
  // bundle-vs-single pairs never merge, however strong the overlap.
  if (hasBundleMismatch(a.offer.title, b.offer.title)) return false;
  if (hasDistinctiveTokens(a.offer.title, b.offer.title)) return false;
  if (sameBrand(a.offer.title, b.offer.title)) {
    return titlesAgree(a.offer.title, b.offer.title);
  }
  // Query-brand fallback: only when the brand check failed because at
  // least one side has no identifiable brand (a generic lead word like
  // "Moisturizing"). The pair may still match if the query names a brand,
  // at least one title carries that brand token, and title overlap is
  // strong. Two different identified brands never reach this branch,
  // and a listing whose identified brand is NOT the query brand never
  // joins through it either.
  if (queryBrand) {
    const ba = extractBrand(a.offer.title);
    const bb = extractBrand(b.offer.title);
    if (
      (ba === null || bb === null) &&
      (ba === null || ba === queryBrand) &&
      (bb === null || bb === queryBrand) &&
      (titleHasToken(a.offer.title, queryBrand) || titleHasToken(b.offer.title, queryBrand)) &&
      fallbackTokensAgree(a.offer.title, b.offer.title, queryBrand)
    ) {
      return titlesAgree(a.offer.title, b.offer.title);
    }
  }
  return false;
}

export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/(\d)(ml|g|gm|kg|oz|fl|l)\b/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function getProductKey(item: { catalogId?: string | null; title: string }): string {
  if (item.catalogId && item.catalogId.trim().length > 0) {
    return item.catalogId.trim();
  }
  return normalizeTitleKey(item.title);
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
    immersiveToken: raw.immersiveToken,
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

export interface GroupSavings {
  savings: number;
  savingsLabel: string;
  savingsPercent: number;
  comparisonPrice: number;
  comparisonLabel: string;
}

/**
 * Calculates honest savings for a group, excluding extreme outlier prices.
 *
 * Excludes prices above 3× the group's median price from the max used for the
 * saving calculation, so a wild import listing (e.g. ₹6,947.78 GoSupps import
 * vs ₹600 domestic) does not inflate the saving claim to 91%.
 * If fewer than 2 prices remain after outlier exclusion, or all remaining prices
 * come from a single store, no saving is claimed (returns null).
 */
export function computeGroupSavings(
  offers: Array<{ price: number | null; store: string }>,
  currency: string,
): GroupSavings | null {
  const stores = new Set(offers.map((o) => o.store.toLowerCase()));
  if (stores.size <= 1) return null;

  const prices = offers
    .map((o) => o.price)
    .filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);

  if (prices.length < 2) return null;

  let validPrices: number[];
  if (prices.length < 3) {
    const min = prices[0];
    const max = prices[prices.length - 1];
    // For small groups (<3 prices), the median is the midpoint so an outlier
    // drags the median up with it. Use a direct ratio check instead:
    validPrices = max > 3 * min ? prices.filter((p) => p !== max) : prices;
  } else {
    // Gap / cluster check for bimodal groups (e.g. domestic cluster + import cluster):
    // find the largest adjacent gap ratio (next / current).
    let maxRatio = 1;
    let splitIndex = -1;
    for (let i = 0; i < prices.length - 1; i++) {
      const ratio = prices[i + 1] / prices[i];
      if (ratio > maxRatio) {
        maxRatio = ratio;
        splitIndex = i;
      }
    }

    let candidates = prices;
    if (maxRatio > 3 && splitIndex >= 1) {
      // Splits into a lower cluster of at least 2 prices and an upper cluster.
      // Exclude the whole upper cluster from the saving calculation.
      candidates = prices.slice(0, splitIndex + 1);
    }

    if (candidates.length < 2) return null;

    if (candidates.length < 3) {
      const min = candidates[0];
      const max = candidates[candidates.length - 1];
      validPrices = max > 3 * min ? candidates.filter((p) => p !== max) : candidates;
    } else {
      const mid = Math.floor(candidates.length / 2);
      const median = candidates.length % 2 !== 0 ? candidates[mid] : (candidates[mid - 1] + candidates[mid]) / 2;
      const threshold = 3 * median;
      validPrices = candidates.filter((p) => p <= threshold);
    }
  }

  if (validPrices.length < 2) return null;

  const lowest = validPrices[0];
  const max = validPrices[validPrices.length - 1];
  const savings = Math.round((max - lowest) * 100) / 100;
  if (savings <= 0 || max <= 0) return null;

  const savingsPercent = Math.round((savings / max) * 100);
  if (savingsPercent <= 0) return null;

  return {
    savings,
    savingsLabel: formatPrice(savings, currency),
    savingsPercent,
    comparisonPrice: max,
    comparisonLabel: formatPrice(max, currency),
  };
}

export function buildGroups(
  rawOffers: RawOffer[],
  fallbackCurrency: string,
  queryBrand: string | null = null,
): ProductGroup[] {
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
    // A candidate joins a cluster only when it matches some member
    // AND conflicts with no member (a stated size/SPF/multipack
    // conflict, or bundle-vs-single). Matching any member keeps one
    // quirky title from fragmenting a group, but the no-conflict rule
    // stops a size-less listing from bridging two stated variants
    // (live Nov 2026: a size-less title bridged the 30 ml and 60 ml
    // Ordinary serums), and stops a bundle sharing a catalog id from
    // joining a cluster of singles. (The distinctive-token guard is
    // deliberately NOT in this check: two noisy titles for the same
    // product can each keep a token the other lacks, and they still
    // belong together — the guard already runs on the admitting pair
    // in offersMatch.)
    // Two more conditions, both against the cluster's SEED (its first
    // member, which defines the cluster's line) — see seedLineAgrees
    // and sizeLineOk. Without them, a plain title with no line words
    // of its own bridges every line into one catch-all, and a
    // size-stated listing is absorbed into a size-less cluster of a
    // different line (live Nov 2026: the Cetaphil catch-all).
    // When several clusters qualify, the candidate joins the FIRST
    // one (in cluster-creation order). The previous largest-cluster
    // rule snowballed instead: a plain title qualifies for several
    // clusters at once, so it piled into whichever was biggest — with
    // the seed checks in place the Foaming cluster still grew to 17
    // offers in the replay. First-match keeps grouping deterministic
    // and order-stable, and no existing check relies on largest: the
    // Ordinary no-size listing seeds its cluster (it arrives first),
    // it does not join by size.
    let target: PreparedOffer[] | null = null;
    for (const cluster of clusters) {
      const seed = cluster[0];
      if (
        seedLineAgrees(candidate, seed) &&
        sizeLineOk(candidate, seed) &&
        cluster.some((member) => offersMatch(candidate, member, queryBrand)) &&
        cluster.every(
          (member) =>
            !statedVariantConflict(candidate.variant, member.variant) &&
            !hasBundleMismatch(candidate.offer.title, member.offer.title),
        )
      ) {
        target = cluster;
        break;
      }
    }
    if (target !== null) target.push(candidate);
    else clusters.push([candidate]);
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
    const savingsInfo = computeGroupSavings(cluster.map((c) => c.offer), currency);
    const savingsLabel = savingsInfo ? savingsInfo.savingsLabel : formatPrice(0, currency);
    const savingsPercent = savingsInfo ? savingsInfo.savingsPercent : 0;
    const bestRated = [...offers].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))[0];
    const image = offers.find((o) => o.imageUrl)?.imageUrl ?? null;
    const catalogId = cluster.find((c) => c.offer.catalogId)?.offer.catalogId ?? null;
    const productKey = getProductKey({ catalogId, title: cluster[0].offer.title });
    return {
      id: `g${idx + 1}`,
      productKey,
      title: cluster[0].offer.title,
      imageUrl: image,
      currency,
      lowestPrice: lowest,
      lowestLabel: formatPrice(lowest, currency),
      highestPrice: highest,
      highestLabel: formatPrice(highest, currency),
      storeCount: stores.size,
      savingsLabel,
      savingsPercent,
      rating: bestRated?.rating ?? null,
      reviews: bestRated?.reviews ?? null,
      offers: withFlags,
    };
  });

  // Multi-store groups first (real comparisons surface first), then
  // single-store groups; lowest price within each tier.
  groups.sort(
    (a, b) =>
      (b.storeCount > 1 ? 1 : 0) - (a.storeCount > 1 ? 1 : 0) || a.lowestPrice - b.lowestPrice,
  );
  return groups;
}

/** Flat priced offers, lowest first, with cheapest flags per group applied. */
export function flattenOffers(groups: ProductGroup[]): Offer[] {
  const all = groups.flatMap((g) => g.offers);
  all.sort((a, b) => a.price - b.price);
  return all;
}
