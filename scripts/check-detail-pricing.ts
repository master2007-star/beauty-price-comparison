/**
 * Fixture-based verification for the detail-view live pricing.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:detail-pricing
 */
import {
  applyLivePrices,
  computeEffectiveStats,
  detailRowKey,
  filterVisibleDetailRows,
  isDetailRowHidden,
  liveInrPrice,
} from "../src/lib/detail-pricing";
import { getProductThumbSource } from "../src/components/Results";
import { pickGroupImage } from "../src/lib/grouping";
import { cleanImageUrl } from "../src/lib/providers";
import type { Offer, RefreshPricesResult } from "../src/lib/types";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function offer(partial: Partial<Offer> & { store: string; price: number }): Offer {
  return {
    priceLabel: `₹${partial.price}`,
    currency: "INR",
    title: "Test Product",
    provider: "serpapi",
    productUrl: null,
    directUrl: null,
    rating: null,
    reviews: null,
    imageUrl: null,
    catalogId: null,
    productId: null,
    productToken: null,
    immersiveToken: null,
    ...partial,
  };
}

function live(key: string, livePrice: number, currency = "INR"): RefreshPricesResult {
  return { key, status: "live", livePrice, currency, directUrl: "https://example.com/p/1" };
}

/* ------------------------- the live case ------------------------- */
/* Server: Shopsy 330, Amazon.in 1199, SweetCare 1378.24. Live prices
 * resolve SweetCare at 878.24. Expected: order 330 / 878.24 / 1199 and
 * SweetCare's delta "+₹548.24 vs lowest" (878.24 - 330). */

const server1 = [
  offer({ store: "Shopsy", price: 330, isCheapest: true, deltaLabel: null }),
  offer({ store: "Amazon.in", price: 1199, deltaLabel: "+₹869 vs lowest" }),
  offer({ store: "SweetCare", price: 1378.24, deltaLabel: "+₹1,048.24 vs lowest" }),
];
const live1: Record<string, RefreshPricesResult> = {
  [detailRowKey(server1[2], 2)]: live(detailRowKey(server1[2], 2), 878.24),
};
const rows1 = applyLivePrices(server1, live1, "INR");

check(
  "live case: order is Shopsy 330, SweetCare 878.24, Amazon.in 1199",
  rows1.map((r) => r.offer.store).join(",") === "Shopsy,SweetCare,Amazon.in" &&
    rows1[0].effectivePrice === 330 &&
    rows1[1].effectivePrice === 878.24 &&
    rows1[2].effectivePrice === 1199,
  `got ${rows1.map((r) => `${r.offer.store} ${r.effectivePrice}`).join(" / ")}`,
);
check(
  "live case: SweetCare delta is +₹548.24 vs lowest",
  rows1[1].deltaLabel === "+₹548.24 vs lowest",
  `got ${rows1[1].deltaLabel}`,
);
check(
  "live case: Shopsy stays cheapest with no delta",
  rows1[0].isCheapest === true && rows1[0].deltaLabel === null,
);
check(
  "live case: SweetCare keeps its live result (badge + warmed URL survive the re-sort)",
  rows1[1].isLive === true && rows1[1].live?.directUrl === "https://example.com/p/1",
);
check(
  "live case: Amazon.in delta recomputes against the live lowest",
  rows1[2].deltaLabel === "+₹869 vs lowest",
  `got ${rows1[2].deltaLabel}`,
);

/* ------------------- no live prices yet ------------------- */

const rows2 = applyLivePrices(server1, {}, "INR");
check(
  "no live prices: server order unchanged",
  rows2.map((r) => r.offer.store).join(",") === "Shopsy,Amazon.in,SweetCare",
  `got ${rows2.map((r) => r.offer.store).join(",")}`,
);
check(
  "no live prices: server deltas unchanged",
  rows2[1].deltaLabel === "+₹869 vs lowest" && rows2[2].deltaLabel === "+₹1,048.24 vs lowest",
  `got ${rows2[1].deltaLabel} / ${rows2[2].deltaLabel}`,
);
check(
  "no live prices: cheapest flag unchanged",
  rows2[0].isCheapest === true && rows2[1].isCheapest === false && rows2[2].isCheapest === false,
);

const unavailable1: Record<string, RefreshPricesResult> = {
  [detailRowKey(server1[1], 1)]: {
    key: detailRowKey(server1[1], 1),
    status: "unavailable",
    livePrice: null,
    currency: null,
  },
};
const rows2b = applyLivePrices(server1, unavailable1, "INR");
check(
  "unavailable rows keep server order and deltas",
  rows2b.map((r) => r.offer.store).join(",") === "Shopsy,Amazon.in,SweetCare" &&
    rows2b[2].deltaLabel === "+₹1,048.24 vs lowest",
);

/* ------------------- live lowest moves ------------------- */

const server3 = [
  offer({ store: "Store A", price: 600, isCheapest: true, deltaLabel: null }),
  offer({ store: "Store B", price: 700, deltaLabel: "+₹100 vs lowest" }),
];
const live3: Record<string, RefreshPricesResult> = {
  [detailRowKey(server3[0], 0)]: live(detailRowKey(server3[0], 0), 550),
};
const rows3 = applyLivePrices(server3, live3, "INR");
check(
  "live lowest moves: Store B delta recomputes against ₹550",
  rows3[1].deltaLabel === "+₹150 vs lowest",
  `got ${rows3[1].deltaLabel}`,
);
check(
  "live lowest moves: order follows the new prices",
  rows3[0].offer.store === "Store A" && rows3[0].effectivePrice === 550 && rows3[0].isCheapest === true,
);

/* ------------------- foreign currency ignored ------------------- */
/* A live price in another currency (e.g. USD 12.56 on a foreign store
 * variant) must never re-sort rows or change a delta. */

const live4: Record<string, RefreshPricesResult> = {
  [detailRowKey(server1[2], 2)]: live(detailRowKey(server1[2], 2), 12.56, "USD"),
};
const rows4 = applyLivePrices(server1, live4, "INR");
check(
  "foreign-currency live price is ignored (no re-sort, no delta change)",
  rows4.map((r) => r.offer.store).join(",") === "Shopsy,Amazon.in,SweetCare" &&
    rows4[2].deltaLabel === "+₹1,048.24 vs lowest",
);
check("liveInrPrice rejects non-INR", liveInrPrice(live("k", 12.56, "USD")) === null);
check("liveInrPrice rejects unavailable", liveInrPrice(unavailable1[detailRowKey(server1[1], 1)]) === null);

/* ------------------- unverified / mismatch status ------------------- */
const unverifiedLive: Record<string, RefreshPricesResult> = {
  [detailRowKey(server1[1], 1)]: {
    key: detailRowKey(server1[1], 1),
    status: "unverified",
    livePrice: null,
    currency: null,
    directUrl: "https://example.com/p/unverified",
  },
};
const rowsUnverified = applyLivePrices(server1, unverifiedLive, "INR");
check(
  "unverified row flags isUnverified=true and keeps snapshot price",
  rowsUnverified[1].isUnverified === true && rowsUnverified[1].effectivePrice === 1199,
);

const verifiedLive: Record<string, RefreshPricesResult> = {
  [detailRowKey(server1[1], 1)]: {
    key: detailRowKey(server1[1], 1),
    status: "live",
    livePrice: 1150,
    currency: "INR",
    directUrl: "https://example.com/p/verified",
    verifiedAt: "2026-11-24T16:00:00.000Z",
  },
};
const rowsVerified = applyLivePrices(server1, verifiedLive, "INR");
check(
  "verified row preserves verifiedAt timestamp",
  rowsVerified.find((r) => r.offer.store === "Amazon.in")?.verifiedAt === "2026-11-24T16:00:00.000Z",
);

/* ------------------- R2: hide unresolvable rows ------------------- */
const r2Offers = [
  offer({ store: "Shopsy", price: 330, isCheapest: true, deltaLabel: null }),
  offer({ store: "Nykaa", price: 735, deltaLabel: "+₹405 vs lowest" }),
  offer({ store: "Amazon.in", price: 999, deltaLabel: "+₹669 vs lowest" }),
];
const r2Live: Record<string, RefreshPricesResult> = {
  [detailRowKey(r2Offers[0], 0)]: {
    key: detailRowKey(r2Offers[0], 0),
    status: "unavailable",
    livePrice: null,
    currency: null,
    directUrl: undefined,
  },
  [detailRowKey(r2Offers[1], 1)]: {
    key: detailRowKey(r2Offers[1], 1),
    status: "live",
    livePrice: 735,
    currency: "INR",
    directUrl: "https://www.nykaa.com/p/1",
  },
  // Amazon.in not in live map (never attempted / beyond cap)
};

const r2Rows = applyLivePrices(r2Offers, r2Live, "INR");
const { visibleRows: r2Visible, hiddenCount: r2HiddenCount } = filterVisibleDetailRows(r2Rows);

check(
  "R2 (a): row whose warmed resolve returned null and has no directUrl is excluded from rendered rows",
  r2Visible.some((r) => r.offer.store === "Shopsy") === false && r2HiddenCount === 1,
);

check(
  "R2 (b): row whose resolve was never attempted stays rendered",
  r2Visible.some((r) => r.offer.store === "Amazon.in") === true,
);

check(
  "R2 (c): deltas and lowest are computed over ALL offers including the hidden row",
  r2Rows.some((r) => r.offer.store === "Shopsy" && r.isCheapest === true) &&
  r2Visible.find((r) => r.offer.store === "Nykaa")?.deltaLabel === "+₹405 vs lowest",
);

/* ------------------- Addendum 2: never-empty guardrail & pending rows ------------------- */
const allFailingOffers = [
  offer({ store: "Store A", price: 300 }),
  offer({ store: "Store B", price: 350 }),
  offer({ store: "Store C", price: 400 }),
];
const allFailingLive: Record<string, RefreshPricesResult> = {
  [detailRowKey(allFailingOffers[0], 0)]: { key: detailRowKey(allFailingOffers[0], 0), status: "unavailable", livePrice: null, currency: null, directUrl: undefined },
  [detailRowKey(allFailingOffers[1], 1)]: { key: detailRowKey(allFailingOffers[1], 1), status: "unavailable", livePrice: null, currency: null, directUrl: undefined },
  [detailRowKey(allFailingOffers[2], 2)]: { key: detailRowKey(allFailingOffers[2], 2), status: "unavailable", livePrice: null, currency: null, directUrl: undefined },
};
const allFailingRows = applyLivePrices(allFailingOffers, allFailingLive, "INR");
const { visibleRows: guardedRows, hiddenCount: guardedHidden } = filterVisibleDetailRows(allFailingRows);
check(
  "Addendum 2 (a): never-empty guardrail keeps all rows visible when every row would be hidden",
  guardedRows.length === 3 && guardedHidden === 0,
);

const pendingOffers = [
  offer({ store: "Store P", price: 500 }),
];
const pendingLive: Record<string, RefreshPricesResult> = {}; // in flight, no result received yet
const pendingRows = applyLivePrices(pendingOffers, pendingLive, "INR");
const { visibleRows: pVisible } = filterVisibleDetailRows(pendingRows);
check(
  "Addendum 2 (b): pending rows whose refresh is in flight stay visible",
  pVisible.length === 1 && pVisible[0].offer.store === "Store P",
);

/* ------------------- R3: product thumbnail & placeholder checks ------------------- */
const noThumb = getProductThumbSource(null, false);
const emptyThumb = getProductThumbSource("", false);
check(
  "R3 (a): offer with no thumbnail renders placeholder, not a broken image",
  noThumb.type === "placeholder" && emptyThumb.type === "placeholder",
);

const validThumb = getProductThumbSource("https://encrypted-tbn0.gstatic.com/images?q=tbn:xyz", false);
check(
  "R3 (b): offer with thumbnail renders thumbnail URL",
  validThumb.type === "image" && validThumb.src === "https://encrypted-tbn0.gstatic.com/images?q=tbn:xyz",
);

const failedThumb = getProductThumbSource("https://encrypted-tbn0.gstatic.com/images?q=tbn:xyz", true);
check(
  "R3 (c): failed image load falls back to placeholder",
  failedThumb.type === "placeholder",
);

const unescapedDataUri = cleanImageUrl("data:image/webp;base64,UklGRv\\x3d\\x3d");
check(
  "R3 (d): data URI with JS hex escapes is sanitized to valid base64",
  unescapedDataUri === "data:image/webp;base64,UklGRv==",
);

const groupImage = pickGroupImage([
  { imageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
  { imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc" },
]);
check(
  "R3 (e): pickGroupImage prioritizes clean https CDN URL over data URI",
  groupImage === "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",
);

/* ------------------- F4: applyLivePrices preserves row count and effective stats ------------------- */
const f4Offers = [
  offer({ store: "Purplle.com - Purplle- MP", price: 204 }),
  offer({ store: "Slikk Club", price: 213 }),
  offer({ store: "Purplle.com", price: 441 }),
];
const f4Live: Record<string, RefreshPricesResult> = {
  [detailRowKey(f4Offers[0], 0)]: {
    key: detailRowKey(f4Offers[0], 0),
    status: "unverified",
    livePrice: null,
    currency: null,
  },
  [detailRowKey(f4Offers[2], 2)]: {
    key: detailRowKey(f4Offers[2], 2),
    status: "live",
    livePrice: 422,
    currency: "INR",
  },
};
const f4Rows = applyLivePrices(f4Offers, f4Live, "INR");
check(
  "F4 (a): applyLivePrices never drops a row (count before and after identical)",
  f4Rows.length === f4Offers.length,
);

const f4Stats = computeEffectiveStats(f4Rows, "INR", {
  lowestPrice: 204,
  highestPrice: 441,
  lowestLabel: "₹204",
  highestLabel: "₹441",
});
check(
  "F4 (b): header lowest/highest derive from same effective prices as list (lowest: 204, highest: 422)",
  f4Stats.lowestPrice === 204 && f4Stats.highestPrice === 422 && f4Stats.highestLabel === "₹422",
);

console.log(failures === 0 ? "\nAll detail-pricing checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
