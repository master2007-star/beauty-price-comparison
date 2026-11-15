/**
 * Price parsing and formatting. Pure functions, no I/O.
 *
 * Providers return prices as display strings ("₹1,299.00", "$12.99",
 * "Rs. 499") and sometimes as extracted numbers. We parse defensively and
 * never guess a price: unparseable means null.
 */

const CURRENCY_SYMBOLS: Array<{ re: RegExp; code: string }> = [
  { re: /₹|rs\.?|inr/i, code: "INR" },
  { re: /\$|usd/i, code: "USD" },
  { re: /€|eur/i, code: "EUR" },
  { re: /£|gbp/i, code: "GBP" },
  { re: /¥|jpy/i, code: "JPY" },
  { re: /₽|rub/i, code: "RUB" },
  { re: /₩|krw/i, code: "KRW" },
  { re: /A\$|aud/i, code: "AUD" },
  { re: /C\$|cad/i, code: "CAD" },
];

export function detectCurrency(priceLabel: string | null | undefined, fallback: string): string {
  if (priceLabel) {
    for (const { re, code } of CURRENCY_SYMBOLS) {
      if (re.test(priceLabel)) return code;
    }
  }
  return fallback;
}

/**
 * Parse a display price string into a number. Handles thousands separators
 * and both "." and "," decimal styles. Returns null when nothing numeric
 * can be recovered.
 */
export function parsePriceLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  // Keep digits, dots, commas, minus. Drop currency symbols/letters/spaces.
  const cleaned = label.replace(/[^0-9.,-]/g, "").trim();
  if (!cleaned) return null;
  let normalized = cleaned;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator.
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    // Only commas: decimal comma when exactly 2 digits follow the last one,
    // otherwise thousands separators.
    const after = cleaned.length - lastComma - 1;
    normalized = after === 2 ? cleaned.replace(/,/g, ".") : cleaned.replace(/,/g, "");
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/** Prefer a provider's extracted numeric price; fall back to parsing its label. */
export function coercePrice(
  extracted: unknown,
  label: string | null | undefined,
): { price: number | null; label: string | null } {
  const num = typeof extracted === "number" && Number.isFinite(extracted) && extracted > 0 ? extracted : null;
  if (num !== null) return { price: Math.round(num * 100) / 100, label: label ?? null };
  const parsed = parsePriceLabel(label);
  return { price: parsed, label: label ?? null };
}

export function defaultCurrencyForRegion(region: string): string {
  const map: Record<string, string> = {
    in: "INR",
    us: "USD",
    gb: "GBP",
    uk: "GBP",
    de: "EUR",
    fr: "EUR",
    es: "EUR",
    it: "EUR",
    jp: "JPY",
    kr: "KRW",
    au: "AUD",
    ca: "CAD",
  };
  return map[region.toLowerCase()] ?? "USD";
}

export function formatPrice(value: number, currency: string): string {
  const locale = currency === "INR" ? "en-IN" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-US")}`;
  }
}

/** "+₹X vs lowest" delta label; null when there is no gap. */
export function deltaLabel(price: number, lowest: number, currency: string): string | null {
  const diff = Math.round((price - lowest) * 100) / 100;
  if (diff <= 0) return null;
  return `+${formatPrice(diff, currency)} vs lowest`;
}

export function normalizeStoreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(com|in|co\.in|co\.uk|shop|store)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(mp|marketplace|official|store|shopping|india)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Fuzzy store match: equal after normalisation, or one contains the other. */
export function storesMatch(a: string, b: string): boolean {
  const na = normalizeStoreName(a);
  const nb = normalizeStoreName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Guard against tiny fragments matching everything ("a" in "amazon").
  if (na.length < 3 || nb.length < 3) return false;
  return na.includes(nb) || nb.includes(na);
}

export function pricesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}
