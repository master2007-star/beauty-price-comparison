/**
 * Detail-view pricing: re-sort a group's offers by their live price and
 * recompute the cheapest flag + deltas once live prices resolve. Pure
 * functions, no I/O — covered by scripts/check-detail-pricing.ts without
 * a database or network.
 *
 * Why this exists: the detail view shows each row's live price in place
 * (StoreRows in src/components/Results.tsx), but it kept the server
 * order and the server deltas — so a row whose live price dropped (e.g.
 * SweetCare ₹1,378.24 -> ₹878.24 live) sat after ₹1,199 rows with a
 * stale "+₹1,048.24 vs lowest" delta. The row key
 * `${store}-${price}-${index}` is built from the ORIGINAL server order,
 * so the original index travels with each row and the live result (the
 * Live badge + the warmed direct URL) stays attached after re-sorting.
 */
import { deltaLabel, formatPrice } from "./format";
import type { Offer, RefreshPricesResult } from "./types";

/** One offer row in the detail view, with its live price applied. */
export interface DetailRow {
  /** The original offer — the server price stays the row identity. */
  offer: Offer;
  /** Index in the server order; the row key is built from this, so it
   *  is stable across re-sorting. */
  index: number;
  /** The raw live result for this row, when the refresh returned one. */
  live?: RefreshPricesResult;
  /** True when a live INR price resolved for this row. */
  isLive: boolean;
  /** True when the retailer price could not be verified or differed from expected variant. */
  isUnverified: boolean;
  /** ISO timestamp when the retailer price was verified. */
  verifiedAt: string | null;
  /** Live INR price when resolved, otherwise the server price. */
  effectivePrice: number;
  /** True for the cheapest row after live prices are applied. */
  isCheapest: boolean;
  /** "+₹X vs lowest" against the live lowest, null for the cheapest. */
  deltaLabel: string | null;
}

/** The row key the detail view uses: `${store}-${price}-${index}`. */
export function detailRowKey(offer: Offer, index: number): string {
  return `${offer.store}-${offer.price}-${index}`;
}

/** A row's live INR price, or null when none resolved (unavailable,
 *  foreign currency, or a missing/invalid value). */
export function liveInrPrice(live: RefreshPricesResult | undefined): number | null {
  if (!live || live.status !== "live" || live.currency !== "INR") return null;
  if (typeof live.livePrice !== "number" || !Number.isFinite(live.livePrice) || live.livePrice <= 0) {
    return null;
  }
  return live.livePrice;
}

/**
 * Apply resolved live prices to a group's offers. When at least one live
 * INR price resolved, the rows are re-sorted ascending by effective price
 * (live INR price, server price as fallback) and isCheapest/deltaLabel
 * are recomputed against the live lowest. When no live INR price has
 * resolved yet, the rows keep the server order and the server flags.
 */
export function applyLivePrices(
  offers: Offer[],
  livePrices: Record<string, RefreshPricesResult>,
  currency: string,
): DetailRow[] {
  const rows: DetailRow[] = offers.map((offer, index) => {
    const live = livePrices[detailRowKey(offer, index)];
    const livePrice = liveInrPrice(live);
    const isUnverified = Boolean(live && livePrice === null);
    return {
      offer,
      index,
      live,
      isLive: livePrice !== null,
      isUnverified,
      verifiedAt: livePrice !== null ? live?.verifiedAt ?? null : null,
      effectivePrice: livePrice ?? offer.price,
      isCheapest: offer.isCheapest ?? false,
      deltaLabel: offer.deltaLabel ?? null,
    };
  });
  if (!rows.some((r) => r.isLive)) return rows;
  const sorted = [...rows].sort(
    (a, b) => a.effectivePrice - b.effectivePrice || a.offer.store.localeCompare(b.offer.store),
  );
  const lowest = sorted[0].effectivePrice;
  return sorted.map((row, i) => ({
    ...row,
    isCheapest: i === 0,
    deltaLabel: i === 0 ? null : deltaLabel(row.effectivePrice, lowest, currency),
  }));
}

/**
 * Derives header stats from the effective prices used in the detail rows.
 * When live prices resolve, header LOWEST/HIGHEST track the list's effective
 * prices so the header never shows a stale search-time figure.
 */
export function computeEffectiveStats(
  rows: DetailRow[],
  currency: string,
  fallback: { lowestPrice: number; highestPrice: number; lowestLabel: string; highestLabel: string },
): { lowestPrice: number; highestPrice: number; lowestLabel: string; highestLabel: string } {
  if (!rows || rows.length === 0) return fallback;
  const prices = rows.map((r) => r.effectivePrice).filter((p) => p > 0);
  if (prices.length === 0) return fallback;
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  return {
    lowestPrice: lowest,
    highestPrice: highest,
    lowestLabel: formatPrice(lowest, currency),
    highestLabel: formatPrice(highest, currency),
  };
}

/**
 * Background refreshes update price/badge/link state, never membership.
 * Only an individual failed store-button click can hide that row.
 */
export function isDetailRowHidden(
  row: DetailRow,
  clickedFailedKeys?: Set<string>,
): boolean {
  return Boolean(clickedFailedKeys?.has(detailRowKey(row.offer, row.index)));
}

/**
 * Filters rows for display in the detail view while keeping deltas and
 * statistics calculated across all offers.
 *
 * Never-empty guardrail: if all rows would be hidden, keep ALL rows visible.
 * Detail view must never show zero rows with an empty card.
 */
export function filterVisibleDetailRows(
  rows: DetailRow[],
  clickedFailedKeys?: Set<string>,
): { visibleRows: DetailRow[]; hiddenCount: number } {
  const unclicked = rows.filter((r) => !clickedFailedKeys?.has(detailRowKey(r.offer, r.index)));
  const visible = unclicked.filter((r) => !isDetailRowHidden(r));
  // Background failures can restore unclicked rows, never rows the user
  // already tried. Keep the final failed row as an unavailable row so the
  // card remains nonempty without resurrecting earlier failed clicks.
  if (visible.length === 0 && rows.length > 0) {
    const guarded = unclicked.length ? unclicked : rows.slice(-1);
    return { visibleRows: guarded, hiddenCount: rows.length - guarded.length };
  }
  return { visibleRows: visible, hiddenCount: rows.length - visible.length };
}
