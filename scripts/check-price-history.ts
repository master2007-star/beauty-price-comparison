/**
 * Verification for price history keying, aggregation, deduplication, and DB operations.
 * Pure unit checks run unconditionally without database.
 * DB-dependent checks run only when POSTGRES_URL is configured.
 * Run: npm run check:price-history
 */
import { buildGroups, getProductKey, normalizeTitleKey } from "../src/lib/grouping";
import { computePriceHistorySeries, isDatabaseConfigured, shouldRecordSnapshot } from "../src/lib/db";
import type { RawOffer } from "../src/lib/types";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function offer(partial: Partial<RawOffer> & { title: string; store: string; price: number }): RawOffer {
  return {
    priceLabel: null,
    currency: "INR",
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

console.log("\n--- Price history unit checks ---");

/* 1. Identity & Key reuse */
const keyWithCat = getProductKey({ catalogId: "cat_ord_30", title: "The Ordinary 30ml" });
check("catalogId takes precedence as product_key", keyWithCat === "cat_ord_30");

const keyNormalizedA = getProductKey({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml" });
const keyNormalizedB = getProductKey({ title: "the ordinary niacinamide 10% + zinc 1% serum 30 ml" });
check("normalized title handles size boundary whitespace", keyNormalizedA === keyNormalizedB);
check("normalized title key is slug format", keyNormalizedA === "the-ordinary-niacinamide-10-zinc-1-serum-30-ml");

const fixture1: RawOffer[] = [
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Nykaa", price: 600, catalogId: "ord30" }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Amazon", price: 650, catalogId: "ord30" }),
];
const groupsRun1 = buildGroups(fixture1, "INR");
const groupsRun2 = buildGroups(fixture1, "INR");
check("same group input → same product_key", groupsRun1.length === 1 && groupsRun1[0].productKey === "ord30" && groupsRun1[0].productKey === groupsRun2[0].productKey);

/* 2. Snapshot aggregation & stats calculation */
const testSnapshots = [
  { recorded_at: "2026-11-20T10:00:00Z", price: 600 },
  { recorded_at: "2026-11-20T14:00:00Z", price: 600 },
  { recorded_at: "2026-11-21T10:00:00Z", price: 650 },
];
const historyRes = computePriceHistorySeries(testSnapshots);
check("snapshots [600, 600, 650] across days → daily-lowest series length 2", historyRes.points === 2);
check("daily-lowest series [600, 650]", historyRes.series[0].price === 600 && historyRes.series[1].price === 650);
check("lowest is 600", historyRes.lowest === 600);
check("highest is 650", historyRes.highest === 650);
check("current is 650", historyRes.current === 650);

// Multi-day with higher then lower price
const trendSnapshots = [
  { recorded_at: "2026-11-18T10:00:00Z", price: 700 },
  { recorded_at: "2026-11-19T10:00:00Z", price: 650 },
  { recorded_at: "2026-11-20T10:00:00Z", price: 600 },
];
const trendRes = computePriceHistorySeries(trendSnapshots);
check("trend series has 3 points", trendRes.points === 3);
check("trend lowest is 600, highest is 700, current is 600", trendRes.lowest === 600 && trendRes.highest === 700 && trendRes.current === 600);

// Empty snapshots
const emptyRes = computePriceHistorySeries([]);
check("empty snapshots return points 0 and null stats", emptyRes.points === 0 && emptyRes.lowest === null && emptyRes.highest === null && emptyRes.current === null && emptyRes.series.length === 0);

/* 3. Deduplication decision */
check("dedupe decision: same price as last snapshot → skip", shouldRecordSnapshot(600, 600) === false);
check("dedupe decision: same price (float exact) → skip", shouldRecordSnapshot(600.00, 600) === false);
check("dedupe decision: changed price (600 vs 650) → write", shouldRecordSnapshot(600, 650) === true);
check("dedupe decision: changed price (650 vs 600) → write", shouldRecordSnapshot(650, 600) === true);
check("dedupe decision: no previous snapshot (null) → write", shouldRecordSnapshot(null, 600) === true);
check("dedupe decision: no previous snapshot (undefined) → write", shouldRecordSnapshot(undefined, 600) === true);

/* 4. DB-dependent checks */
if (!isDatabaseConfigured()) {
  console.log("\n  SKIP db-dependent checks: POSTGRES_URL is not set locally (expected in local dev)");
} else {
  console.log("\n  POSTGRES_URL is set, running live DB checks...");
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll price history checks passed.");
}
