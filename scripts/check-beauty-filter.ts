/**
 * Fixture-based verification for the beauty-only filter.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:beauty-filter
 */
import { filterBeautyOffers, isBeautyQuery, isBeautyRelevant } from "../src/lib/beauty-filter";
import type { AppConfig } from "../src/lib/env";
import { runSearch } from "../src/lib/search";
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

function offer(title: string): RawOffer {
  return {
    price: 100,
    priceLabel: null,
    currency: "INR",
    store: "Test Store",
    title,
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
  };
}

/* ------------------------- the reported bug ------------------------- */

check(
  "badminton set is dropped",
  !isBeautyRelevant("Kids Badminton Tennis Set Ball Shuttlecock Racket for Starter Players Boys|2 Rackets"),
);

/* --------------------------- obvious junk ---------------------------- */

const junk = [
  "Samsung Galaxy Smartphone 128GB",
  "Nike Running Shoes for Men",
  "Tata Tea Powder 1kg",
  "LEGO Star Wars Toy Set",
  "Yoga Mat 6mm Anti-Slip",
  "Men's Cotton T-Shirt",
  "HP Laptop 15s",
  "Sony WH-1000XM5 Headphones",
  "Milton Stainless Steel Pressure Cooker 5L",
  "School Bag for Kids",
  "Wooden Dining Table Furniture Set",
  "Cricket Bat Kashmir Willow",
];
for (const title of junk) {
  check(`dropped: ${title}`, !isBeautyRelevant(title));
}

/* --------------------------- beauty kept ---------------------------- */

const beauty = [
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA++++",
  "The Ordinary Niacinamide 10% Serum",
  "CeraVe Moisturising Cream 50 ml",
  "L'Oreal Paris Shampoo",
  "Maybelline New York Lipstick",
  "Bajaj Almond Drops Hair Oil",
  "Plum Green Tea Face Wash",
  "Minimalist 10% Vitamin C Face Serum",
  "Lakme Absolute Compact Powder",
  "Philips Hair Straightener with Iron Plates",
];
for (const title of beauty) {
  check(`kept: ${title}`, isBeautyRelevant(title));
}

/* --------------------- beauty wins over denylist --------------------- */

check(
  "coffee + scrub kept (beauty wins)",
  isBeautyRelevant("mCaffeine Coffee Face Scrub"),
);
check(
  "coffee + sunscreen kept (beauty wins)",
  isBeautyRelevant("mCaffeine Coffee Sunscreen Lotion SPF 50"),
);
check(
  "chocolate + lip balm kept (beauty wins)",
  isBeautyRelevant("Chocolate Lip Balm"),
);
check(
  "pen + eyeliner kept (beauty wins)",
  isBeautyRelevant("Lakme Eyeliner Pen"),
);
check(
  "watch + makeup kept (beauty wins)",
  isBeautyRelevant("Makeup Watch Organizer"), // contrived: deny word + beauty word
);

/* --------------------- neither signal: kept ------------------------- */

check("brand-only title kept", isBeautyRelevant("Lakme Absolute"));
check("brand-only title kept (2)", isBeautyRelevant("Dot & Key"));
check("unknown product kept", isBeautyRelevant("Mystery Box Deluxe Edition"));

/* --------------------- whole-word matching -------------------------- */

// "snail" must not match "nail": with a deny word present and no real
// beauty signal, the offer must drop.
check(
  "snail does not match nail (whole words)",
  !isBeautyRelevant("Snail Repair Phone Cover"),
);
// "sandalwood" must not match "sandals".
check(
  "sandalwood does not match sandals",
  isBeautyRelevant("Sandalwood Face Pack"),
);
// "tv" inside "ktv" must not fire the denylist: no deny hit and no beauty
// hit means the offer is kept by the neither-signal rule.
check(
  "tv substring inside ktv does not fire",
  isBeautyRelevant("KTV Wall Mount Stand"),
);

/* --------------------- filter over a mixed set ---------------------- */

const mixed = filterBeautyOffers([
  offer("Kids Badminton Tennis Set Ball Shuttlecock Racket"),
  offer("CeraVe Moisturising Cream 50 ml"),
  offer("Samsung Galaxy Smartphone"),
  offer("Dot & Key Vitamin C Sunscreen SPF 50"),
  offer("Lakme Absolute"),
]);
check(
  "mixed set keeps 3 of 5",
  mixed.length === 3 &&
    mixed.some((o) => o.title.includes("CeraVe")) &&
    mixed.some((o) => o.title.includes("Dot & Key")) &&
    mixed.some((o) => o.title.includes("Lakme")),
  mixed.map((o) => o.title).join(" | "),
);

function finish() {
  console.log(failures === 0 ? "\nAll beauty-filter checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/* --------------------- query-level guard ---------------------------- */

const blockedQueries = [
  "badminton racket",
  "kids shoes",
  "tennis racket",
  "samsung smartphone",
  "yoga mat",
  "cricket bat",
];
for (const q of blockedQueries) {
  check(`query blocked: ${q}`, !isBeautyQuery(q));
}

const allowedQueries = [
  "Vitamin C serum",
  "coffee scrub",
  "chocolate lip balm",
  "face wash",
  "lipstick",
  "sunscreen SPF 50",
];
for (const q of allowedQueries) {
  check(`query allowed: ${q}`, isBeautyQuery(q));
}

// Neither signal: passes through unchanged. Honest limit — a bare brand
// name is never guessed, so "Hundred Powertek 100" still searches.
check("query passes through: Hundred Powertek 100", isBeautyQuery("Hundred Powertek 100"));
check("query passes through: Lakme Absolute", isBeautyQuery("Lakme Absolute"));

/* --------------------- runSearch wiring (no network) ----------------- */

// A no-keys config proves the guard fires before any provider call: the
// blocked query returns the empty ok-shape without reaching the
// no_providers branch, and the allowed query flows through to it. No
// provider is ever called, so no keys or network are involved.
const noKeysCfg: AppConfig = {
  keys: {},
  region: "in",
  language: "en",
  passcode: null,
  sessionSecret: null,
};

async function main() {
  const blocked = await runSearch("badminton racket", noKeysCfg);
  check(
    "runSearch returns empty ok-shape for blocked query",
    blocked.status === "ok" &&
      blocked.groups.length === 0 &&
      blocked.offers.length === 0 &&
      blocked.providerErrors.length === 0 &&
      blocked.providersUsed.length === 0 &&
      blocked.query === "badminton racket",
    JSON.stringify(blocked),
  );

  const allowed = await runSearch("Vitamin C serum", noKeysCfg);
  check(
    "runSearch passes beauty query through to no_providers",
    allowed.status === "no_providers" && allowed.groups.length === 0,
    JSON.stringify(allowed),
  );

  const passthrough = await runSearch("Hundred Powertek 100", noKeysCfg);
  check(
    "runSearch passes neither-signal query through to no_providers",
    passthrough.status === "no_providers",
    JSON.stringify(passthrough),
  );

  finish();
}

main();
