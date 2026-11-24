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
import { deltaLabel } from "./format";
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
    const isUnverified = Boolean(live && (live.status === "unverified" || (live.status === "unavailable" && live.directUrl)));
    return {
      offer,
      index,
      live,
      isLive: livePrice !== null,
      isUnverified,
      verifiedAt: live?.verifiedAt ?? null,
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
 * A store row is hidden ONLY once its link resolution has been attempted
 * and has definitively failed — i.e. the detail refresh already ran for
 * this row and returned no direct URL, or the user clicked "Go to Store"
 * and resolution failed, AND it has no search-time direct URL.
 * Never hide an un-attempted or pending row.
 */
export function isDetailRowHidden(
  row: DetailRow,
  clickedFailedKeys?: Set<string>,
): boolean {
  if (clickedFailedKeys && clickedFailedKeys.has(detailRowKey(row.offer, row.index))) {
    return true;
  }
  // Search-time direct merchant URL is always kept
  if (row.offer.directUrl) return false;
  // Warmed direct URL from refresh is kept
  if (row.live?.directUrl) return false;
  // If resolution was never attempted for this row, it stays visible
  if (!row.live) return false;
  // Resolution was attempted and produced no direct URL
  return true;
}

/**
 * Filters rows for display in the detail view while keeping deltas and
 * statistics calculated across all offers.
 */
export function filterVisibleDetailRows(
  rows: DetailRow[],
  clickedFailedKeys?: Set<string>,
): { visibleRows: DetailRow[]; hiddenCount: number } {
  const visibleRows = rows.filter((r) => !isDetailRowHidden(r, clickedFailedKeys));
  return { visibleRows, hiddenCount: rows.length - visibleRows.length };
}
