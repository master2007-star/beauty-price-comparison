import assert from "node:assert/strict";
import fixture from "./fixtures/observed-ordinary.json";
import { applyLivePrices, computeEffectiveStats, detailRowKey, filterVisibleDetailRows } from "../src/lib/detail-pricing";
import type { Offer, RefreshPricesResult } from "../src/lib/types";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreRows } from "../src/components/Results";
import { buildGroups } from "../src/lib/grouping";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const offers = fixture.offers as Offer[];
const before = filterVisibleDetailRows(applyLivePrices(offers, {}, "INR")).visibleRows;
const failed = Object.fromEntries(offers.map((offer, i) => {
  const key = detailRowKey(offer, i);
  return [key, { key, status: "unavailable", livePrice: null, currency: null }];
})) as Record<string, RefreshPricesResult>;
const after = filterVisibleDetailRows(applyLivePrices(offers, failed, "INR")).visibleRows;
assert.equal(before.length, offers.length);
assert.equal(after.length, before.length);
assert.ok(after.every((r) => r.isUnverified && r.effectivePrice === r.offer.price && !r.verifiedAt));
const fallback = { lowestPrice: Math.min(...offers.map((o) => o.price)), highestPrice: Math.max(...offers.map((o) => o.price)), lowestLabel: "", highestLabel: "" };
const visible = filterVisibleDetailRows(after, new Set([detailRowKey(offers[0], 0)])).visibleRows;
const stats = computeEffectiveStats(visible, "INR", fallback);
assert.equal(stats.lowestPrice, Math.min(...visible.map((r) => r.effectivePrice)));
assert.equal(stats.highestPrice, Math.max(...visible.map((r) => r.effectivePrice)));
const group = buildGroups(offers, "INR")[0];
const render = (visibleRows: typeof before) => renderToStaticMarkup(React.createElement(StoreRows, {
  group, visibleRows, hiddenCount: 0, onUnavailable: () => undefined,
}));
assert.equal((render(before).match(/class="store-row"/g) ?? []).length, offers.length);
const refreshedMarkup = render(after);
assert.equal((refreshedMarkup.match(/class="store-row"/g) ?? []).length, offers.length);
assert.equal((refreshedMarkup.match(/Price needs verification/g) ?? []).length, offers.length);
console.log("PASS Item 4: refresh preserves rendered row count; visible header prices equal effective list prices.");
