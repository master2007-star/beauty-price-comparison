/**
 * Fixture-based verification for the detail-view live pricing.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:detail-pricing
 */
import { applyLivePrices, detailRowKey, liveInrPrice } from "../src/lib/detail-pricing";
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

console.log(failures === 0 ? "\nAll detail-pricing checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
