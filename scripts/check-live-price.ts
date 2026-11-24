/**
 * Fixture-based verification for the live-price extractors (JSON-LD and
 * Amazon twister/corePrice). No network, no provider keys — pure
 * unit-level checks over HTML strings.
 * Run: npm run check:live-price
 */
import { extractAmazonPrice, extractDigihaatPrice, extractJsonLdPrice } from "../src/lib/live-price";
import { isDirectProductUrl, sanitizeProductUrl } from "../src/lib/url";

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

/* --------------------- Amazon twister extraction ---------------------- */
/* Fixture blob shape verified against a real amazon.in PDP fetch
 * 2026-11-16 (offerListingId redacted). */

function amazonPage(...sections: string[]): string {
  return `<html><body>${sections.join("")}</body></html>`;
}

const TWISTER_BLOB = `{"desktop_buybox_group_1":[{"displayPrice":"₹380.00","priceAmount":380.00,"currencySymbol":"₹","integerValue":"380","decimalSeparator":".","fractionalValue":"00","symbolPosition":"left","hasSpace":false,"showFractionalPartIfEmpty":false,"offerListingId":"REDACTED","locale":"en-IN","buyingOptionType":"NEW","aapiBuyingOptionIndex":0}]}`;

function twisterDiv(json: string): string {
  return `<div class="a-section aok-hidden twister-plus-buying-options-price-data">${json}</div>`;
}

const CORE_PRICE = `<div id="corePrice_feature_div" class="celwidget" data-feature-name="corePrice"><span class="a-price"><span class="a-price-symbol">₹</span><span class="a-price-whole">380</span><span class="a-price-decimal">.</span><span class="a-price-fraction">00</span></span></div>`;

check(
  "twister blob parses to 380.00 INR",
  JSON.stringify(extractAmazonPrice(amazonPage(twisterDiv(TWISTER_BLOB), CORE_PRICE))) ===
    JSON.stringify({ price: 380, currency: "INR" }),
  JSON.stringify(extractAmazonPrice(amazonPage(twisterDiv(TWISTER_BLOB), CORE_PRICE))),
);

check(
  "missing blob falls back to corePrice spans",
  JSON.stringify(extractAmazonPrice(amazonPage(CORE_PRICE))) ===
    JSON.stringify({ price: 380, currency: "INR" }),
);

check(
  "malformed blob with no corePrice returns null without throwing",
  (() => {
    try {
      return extractAmazonPrice(amazonPage(twisterDiv(`{not json`))) === null;
    } catch {
      return false;
    }
  })(),
);

check(
  "malformed blob falls back to corePrice spans",
  extractAmazonPrice(amazonPage(twisterDiv(`{not json`), CORE_PRICE))?.price === 380,
);

check(
  "non-rupee symbol passes currency through",
  JSON.stringify(
    extractAmazonPrice(
      amazonPage(
        twisterDiv(
          `{"desktop_buybox_group_1":[{"displayPrice":"$12.99","priceAmount":12.99,"currencySymbol":"$","locale":"en-US","buyingOptionType":"NEW"}]}`,
        ),
      ),
    ),
  ) === JSON.stringify({ price: 12.99, currency: "$" }),
);

check(
  "zero priceAmount is not a price",
  extractAmazonPrice(
    amazonPage(
      twisterDiv(
        `{"desktop_buybox_group_1":[{"displayPrice":"₹0.00","priceAmount":0,"currencySymbol":"₹"}]}`,
      ),
    ),
  ) === null,
);

check(
  "no twister blob and no corePrice returns null",
  extractAmazonPrice(amazonPage(`<div>no price here</div>`)) === null,
);

check(
  "corePrice whole with thousands separator composes correctly",
  extractAmazonPrice(
    amazonPage(
      `<div id="corePrice_feature_div"><span class="a-price"><span class="a-price-symbol">₹</span><span class="a-price-whole">1,299</span><span class="a-price-fraction">50</span></span></div>`,
    ),
  )?.price === 1299.5,
);

/* ------------------- Direct product URL resolution -------------------- */

check(
  "valid merchant product page is recognized",
  isDirectProductUrl("https://www.nykaa.com/the-ordinary-niacinamide-10-zinc-1/p/5000000?skuId=5000000") === true,
);

check(
  "Amazon product /dp/ ASIN link is recognized",
  isDirectProductUrl("https://www.amazon.in/dp/B07797NC2C") === true,
);

check(
  "Maccaron product page is recognized",
  isDirectProductUrl("https://maccaron.in/en/products/the-ordinary-niacinamide-10-zinc-1-30ml/12345/") === true,
);

check(
  "store root homepage is rejected",
  isDirectProductUrl("https://www.nykaa.com/") === false &&
  isDirectProductUrl("https://amazon.in") === false,
);

check(
  "localized homepage is rejected",
  isDirectProductUrl("https://maccaron.in/en/") === false &&
  isDirectProductUrl("https://maccaron.in/en") === false,
);

check(
  "generic store search page is rejected",
  isDirectProductUrl("https://store.com/search?q=niacinamide") === false &&
  isDirectProductUrl("https://www.amazon.in/s?k=serum") === false &&
  isDirectProductUrl("https://store.com/catalogsearch/result/?q=cleanser") === false,
);

check(
  "Google Shopping and Google redirect URLs are rejected",
  isDirectProductUrl("https://www.google.com/shopping/product/123456") === false &&
  isDirectProductUrl("https://googleadservices.com/pagead/aclk?sa=L&ai=123") === false,
);

check(
  "sanitizeProductUrl strips tracking params while preserving product identifiers",
  sanitizeProductUrl(
    "https://store.com/products/serum?variant=123&utm_source=google&utm_medium=cpc&gclid=xyz&skuId=999"
  ) === "https://store.com/products/serum?variant=123&skuId=999",
);

/* ------------------- F5: Digihaat / ONDC price extraction ------------------- */
const digihaatHtmlMeta = `
  <html>
    <head>
      <meta property="og:title" content="Maybelline New York Fit Me Matte & Poreless Foundation Shade 339" />
      <meta property="product:price:amount" content="742.00" />
      <meta property="product:price:currency" content="INR" />
    </head>
    <body>
      <div class="product-details">
        <h1 class="title">Maybelline New York Fit Me Matte & Poreless Foundation Shade 339</h1>
        <div class="price">₹742.00</div>
      </div>
    </body>
  </html>
`;
const digihaatPrice = extractDigihaatPrice(digihaatHtmlMeta);
check(
  "F5: extractDigihaatPrice extracts price from Digihaat / ONDC page markup",
  digihaatPrice !== null && digihaatPrice.price === 742 && digihaatPrice.currency === "INR",
);

const digihaatHtmlClass = `
  <html>
    <body>
      <span class="selling-price">₹ 742</span>
    </body>
  </html>
`;
const digihaatClassPrice = extractDigihaatPrice(digihaatHtmlClass);
check(
  "F5: extractDigihaatPrice extracts selling-price class markup",
  digihaatClassPrice !== null && digihaatClassPrice.price === 742,
);

console.log(failures === 0 ? "\nAll live-price checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
