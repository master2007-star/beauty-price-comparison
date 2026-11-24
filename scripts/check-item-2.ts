import assert from "node:assert/strict";
import fixture from "./fixtures/observed-ordinary.json";
import { applyLivePrices, detailRowKey, filterVisibleDetailRows, isDetailRowHidden } from "../src/lib/detail-pricing";
import type { Offer, RefreshPricesResult } from "../src/lib/types";

const offers = fixture.offers as Offer[];
const failed = Object.fromEntries(offers.map((offer, i) => {
  const key = detailRowKey(offer, i);
  return [key, { key, status: "unavailable", livePrice: null, currency: null }];
})) as Record<string, RefreshPricesResult>;
const rows = applyLivePrices(offers, failed, "INR");
assert.equal(filterVisibleDetailRows(rows).visibleRows.length, offers.length);
const firstKey = detailRowKey(offers[0], 0);
const afterClick = filterVisibleDetailRows(rows, new Set([firstKey]));
assert.equal(afterClick.visibleRows.length, offers.length - 1);
assert.ok(afterClick.visibleRows.every((r) => detailRowKey(r.offer, r.index) !== firstKey));
assert.ok(applyLivePrices(offers, {}, "INR").every((r) => !isDetailRowHidden(r)));
const allClicked = filterVisibleDetailRows(rows, new Set(rows.map((r) => detailRowKey(r.offer, r.index))));
assert.equal(allClicked.visibleRows.length, 1, "Last unavailable row keeps the detail nonempty");
console.log("PASS Item 2: all background failures keep rows; pending rows stay visible; failed clicks do not resurrect.");
