/**
 * Beauty-only filter: Google Shopping fuzzy matching returns irrelevant
 * products (a "Kids Badminton Tennis Set" once appeared on this beauty-only
 * site). Drop an offer only when its title carries a STRONG non-beauty
 * category signal AND no beauty signal at all. Beauty wins ties, and a
 * title with neither signal is kept — the filter removes obvious junk,
 * it never guesses a product's category from a bare brand name.
 *
 * Matching is case-insensitive on whole word tokens, in the tokenization
 * style of grouping.ts (lowercase, non-alphanumeric separators). Phrases
 * match as consecutive token sequences. Tokens are singularised (trailing
 * "s" stripped, mirroring grouping.ts) on both sides, so "rackets" matches
 * "racket" and "shoe" matches "shoes" — but "snail" never matches "nail".
 */
import type { RawOffer } from "./types";

/** Lowercase word tokens; single-char tokens kept ("vitamin c" needs "c"). */
function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    .map(singularise);
}

function singularise(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

/** Parse a signal list entry ("yoga mat", "spf") into singularised tokens. */
function signalTokens(entry: string): string[] {
  return entry
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0)
    .map(singularise);
}

const DENYLIST: string[] = [
  // Sports & outdoors.
  "badminton", "tennis", "cricket", "football", "racket", "racquet",
  "shuttlecock", "dumbbell", "yoga mat", "cycle", "bicycle",
  // Toys & kids.
  "toy", "lego", "doll", "kids cycle", "tricycle", "remote control car",
  // Electronics & appliances.
  "phone", "smartphone", "laptop", "television", "tv", "earbuds",
  "headphones", "charger", "speaker", "smartwatch", "camera", "tablet",
  "refrigerator", "washing machine", "mixer grinder", "fan", "iron",
  // Footwear & apparel ("t-shirt" tokenises to t+shirt; "shirt" covers it).
  "shoes", "sneakers", "sandals", "slippers", "shirt", "jeans", "dress",
  "saree", "kurta", "jacket", "watch",
  // Home & auto.
  "furniture", "sofa", "bedsheet", "curtain", "helmet", "tyre",
  "car accessory", "kitchen", "cookware", "pressure cooker",
  // Grocery / food.
  "rice", "dal", "atta", "biscuits", "chocolate", "coffee", "tea powder",
  // Stationery & other.
  "notebook", "pen", "backpack", "school bag",
];

const BEAUTY_SIGNALS: string[] = [
  // Forms & categories.
  "serum", "cream", "moisturizer", "moisturiser", "sunscreen", "sunblock",
  "lotion", "shampoo", "conditioner", "hair oil", "hairfall", "face wash",
  "facewash", "cleanser", "cleansing", "toner", "lipstick", "lip balm",
  "makeup", "foundation", "concealer", "mascara", "eyeliner", "kajal",
  "eyeshadow", "blush", "highlighter", "nail polish", "nail", "perfume",
  "deodorant", "body wash", "shower gel", "scrub", "exfoliator", "mask",
  "sheet mask", "gel", "balm", "oil", "skincare", "haircare", "beauty",
  "bath", "soap", "handwash", "sanitizer", "face pack", "micellar",
  "essence", "ampoule", "sleeping mask", "sunscreen lotion", "body lotion",
  "body butter", "petroleum jelly", "lip scrub", "foot cream", "under eye",
  "eye cream", "night cream", "day cream", "cold cream", "vanishing cream",
  "compact", "kohl", "sindoor", "bindi", "mehndi", "henna", "talc",
  "fragrance", "attar",
  // Powder forms as phrases only: bare "powder" would defeat the
  // "tea powder" denylist entry, since beauty wins ties.
  "face powder", "compact powder", "setting powder", "loose powder",
  "finishing powder", "makeup powder",
  // Actives & ingredients.
  "vitamin c", "vitamin e", "retinol", "niacinamide", "hyaluronic",
  "ceramide", "salicylic", "glycolic", "aha", "bha", "spf", "pa",
  "keratin", "biotin", "collagen", "charcoal", "clay", "aloe vera",
  "shea", "cocoa butter", "ubtan", "kumkumadi", "rose water",
  // Concerns & claims.
  "glow", "brightening", "anti-ageing", "anti-aging", "acne", "pimple",
  "pigmentation", "tan removal", "fairness", "whitening", "de-tan",
  "detan", "peel off",
  // Hair removal / styling / colour.
  "hair color", "hair colour", "beard", "shaving", "razor", "wax",
  "epilator", "trimmer", "dryer", "straightener", "curler", "hair spa",
];

const DENY_SIGNALS = DENYLIST.map(signalTokens);
const BEAUTY = BEAUTY_SIGNALS.map(signalTokens);

function matchesAny(tokens: string[], signals: string[][]): boolean {
  for (const signal of signals) {
    if (signal.length === 1) {
      if (tokens.includes(signal[0])) return true;
    } else {
      for (let i = 0; i + signal.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < signal.length; j++) {
          if (tokens[i + j] !== signal[j]) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
    }
  }
  return false;
}

/**
 * True when the title may be shown on the beauty-only site: dropped only
 * when a denylist signal hits AND no beauty signal hits.
 */
export function isBeautyRelevant(title: string): boolean {
  const tokens = titleTokens(title);
  if (!matchesAny(tokens, DENY_SIGNALS)) return true;
  return matchesAny(tokens, BEAUTY);
}

/** Drop non-beauty offers from a merged provider result set. */
export function filterBeautyOffers(offers: RawOffer[]): RawOffer[] {
  return offers.filter((o) => isBeautyRelevant(o.title));
}
