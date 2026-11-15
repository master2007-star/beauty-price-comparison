/**
 * Fixture-based verification for the JSON-LD live-price extractor.
 * No network, no provider keys — pure unit-level checks over HTML strings.
 * Run: npm run check:live-price
 */
import { extractJsonLdPrice } from "../src/lib/live-price";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function page(...blocks: string[]): string {
  return `<html><head>${blocks
    .map((b) => `<script type="application/ld+json">${b}</script>`)
    .join("")}</head><body></body></html>`;
}

/* ------------------------- basic extraction -------------------------- */

check(
  "Product offers.price (number, INR)",
  JSON.stringify(extractJsonLdPrice(page(`{
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Test Sunscreen",
    "offers": { "@type": "Offer", "price": 351, "priceCurrency": "INR" }
  }`))) === JSON.stringify({ price: 351, currency: "INR" }),
  JSON.stringify(extractJsonLdPrice(page(`{
    "@context": "https://schema.org",
    "@type": "Product",
    "offers": { "@type": "Offer", "price": 351, "priceCurrency": "INR" }
  }`))),
);

check(
  "price as numeric string with thousands separator",
  extractJsonLdPrice(page(`{
    "@type": "Product",
    "offers": { "@type": "Offer", "price": "1,299.00", "priceCurrency": "INR" }
  }`))?.price === 1299,
);

check(
  "no currency: price returned, currency null",
  JSON.stringify(extractJsonLdPrice(page(`{
    "@type": "Product",
    "offers": { "@type": "Offer", "price": 499 }
  }`))) === JSON.stringify({ price: 499, currency: null }),
);

/* --------------------------- @graph / arrays -------------------------- */

check(
  "@graph array finds the nested Offer",
  extractJsonLdPrice(page(`{
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "name": "Example Store" },
      { "@type": "Product", "offers": { "@type": "Offer", "price": 892, "priceCurrency": "INR" } }
    ]
  }`))?.price === 892,
);

check(
  "top-level JSON array of nodes",
  extractJsonLdPrice(page(`[
    { "@type": "Organization", "name": "Example" },
    { "@type": "Product", "offers": [{ "@type": "Offer", "price": 220, "priceCurrency": "INR" }] }
  ]`))?.price === 220,
);

check(
  "@type as an array containing Offer",
  extractJsonLdPrice(page(`{
    "@type": ["Product", "Offer"],
    "price": 139, "priceCurrency": "INR"
  }`))?.price === 139,
);

/* --------------------------- AggregateOffer --------------------------- */

check(
  "AggregateOffer lowPrice",
  JSON.stringify(extractJsonLdPrice(page(`{
    "@type": "Product",
    "offers": { "@type": "AggregateOffer", "lowPrice": "1,199", "highPrice": "1,499", "priceCurrency": "INR" }
  }`))) === JSON.stringify({ price: 1199, currency: "INR" }),
);

check(
  "Offer price wins over lowPrice on the same node",
  extractJsonLdPrice(page(`{
    "@type": "AggregateOffer", "price": 999, "lowPrice": 899, "priceCurrency": "INR"
  }`))?.price === 999,
);

/* ------------------------ currency preference ------------------------- */

check(
  "INR preferred over an earlier USD price",
  JSON.stringify(extractJsonLdPrice(page(
    `{ "@type": "Offer", "price": 12.99, "priceCurrency": "USD" }`,
    `{ "@type": "Offer", "price": 799, "priceCurrency": "INR" }`,
  ))) === JSON.stringify({ price: 799, currency: "INR" }),
);

check(
  "first INR in document order when several exist",
  extractJsonLdPrice(page(
    `{ "@type": "Offer", "price": 799, "priceCurrency": "INR" }`,
    `{ "@type": "Offer", "price": 749, "priceCurrency": "INR" }`,
  ))?.price === 799,
);

check(
  "first candidate when no INR price exists",
  extractJsonLdPrice(page(
    `{ "@type": "Offer", "price": 12.99, "priceCurrency": "USD" }`,
    `{ "@type": "Offer", "price": 11.99, "priceCurrency": "USD" }`,
  ))?.price === 12.99,
);

check(
  "priceCurrency inherited from the enclosing Product",
  JSON.stringify(extractJsonLdPrice(page(`{
    "@type": "Product",
    "priceCurrency": "INR",
    "offers": { "@type": "Offer", "price": 450 }
  }`))) === JSON.stringify({ price: 450, currency: "INR" }),
);

check(
  "rupee symbol currency normalises to INR",
  extractJsonLdPrice(page(`{
    "@type": "Offer", "price": 299, "priceCurrency": "₹"
  }`))?.currency === "INR",
);

/* --------------------------- no-price cases --------------------------- */

check("no JSON-LD at all returns null", extractJsonLdPrice("<html><body>no scripts</body></html>") === null);

check(
  "non-Offer JSON-LD returns null",
  extractJsonLdPrice(page(`{ "@type": "WebSite", "name": "Example" }`)) === null,
);

check(
  "zero price is not a price",
  extractJsonLdPrice(page(`{ "@type": "Offer", "price": 0, "priceCurrency": "INR" }`)) === null,
);

check(
  "Offer without any price returns null",
  extractJsonLdPrice(page(`{ "@type": "Offer", "priceCurrency": "INR", "availability": "InStock" }`)) === null,
);

/* ------------------------- malformed input ---------------------------- */

let threw = false;
let malformedResult: unknown = "unset";
try {
  malformedResult = extractJsonLdPrice(page(`{ "@type": "Offer", "price": `));
} catch {
  threw = true;
}
check("malformed JSON-LD returns null without throwing", !threw && malformedResult === null);

check(
  "malformed block skipped, valid block still found",
  extractJsonLdPrice(page(
    `{ "@type": "Offer", "price": `,
    `{ "@type": "Offer", "price": 649, "priceCurrency": "INR" }`,
  ))?.price === 649,
);

check(
  "script tag with extra attributes still parsed",
  extractJsonLdPrice(
    `<html><head><script data-x="1" type="application/ld+json">{"@type":"Offer","price":175,"priceCurrency":"INR"}</script></head></html>`,
  )?.price === 175,
);

check(
  "single-quoted type attribute still parsed",
  extractJsonLdPrice(
    `<html><head><script type='application/ld+json'>{"@type":"Offer","price":175,"priceCurrency":"INR"}</script></head></html>`,
  )?.price === 175,
);

console.log(failures === 0 ? "\nAll live-price checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
