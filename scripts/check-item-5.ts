import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import provenance from "./fixtures/digihaat-product-source.json";
import { extractDigihaatPrice, refreshLivePrices } from "../src/lib/live-price";
import { extractOndcProduct } from "../src/lib/ondc-product";
import { extractPdpTitle } from "../src/lib/variant-validation";
import { applyLivePrices } from "../src/lib/detail-pricing";
import { buildGroups } from "../src/lib/grouping";
import { isDirectProductUrl, sanitizeProductUrl } from "../src/lib/url";
import type { RawOffer } from "../src/lib/types";

const html = readFileSync(new URL("./fixtures/digihaat-product.html", import.meta.url), "utf8");
const itemId = new URL(provenance.url).searchParams.get("item_id")!;
// This is a real public Digihaat ONDC PDP captured on 2026-11-24,
// not the unavailable Maybelline PDP. Its selected selling price is ₹69.
assert.deepEqual(extractDigihaatPrice(html, itemId), { price: 69, currency: "INR" });
assert.equal(extractOndcProduct(html, itemId)?.itemId, itemId);
assert.equal(extractPdpTitle(html, itemId), "Rajdhani Besan Cheela 200gm 200 gm");
assert.equal(isDirectProductUrl(provenance.url), true);
assert.equal(sanitizeProductUrl(provenance.url), provenance.url);
assert.equal(isDirectProductUrl("https://www.digihaat.in/en/product"), false);
assert.equal(isDirectProductUrl("https://www.digihaat.in/en/sc/beauty/makeup?view=product"), false);

// Reported Maybelline facts: Shade 339 is NOT Fair Porcelain.
const reported = (title: string, store: string, price: number): RawOffer => ({
  title, store, price, priceLabel: null, currency: "INR", provider: "serper",
  productUrl: null, directUrl: null, imageUrl: null, productId: null,
  catalogId: null, productToken: null, immersiveToken: null, rating: null, reviews: null,
});
const groups = buildGroups([
  reported("Maybelline New York Fit Me Matte & Poreless Foundation Shade 339", "Digihaat", 425),
  reported("Maybelline Fit Me Matte Poreless Foundation Fair Porcelain 30 ml", "Purplle", 214),
], "INR");
assert.equal(groups.length, 2);

async function main() {
  const savedFetch = globalThis.fetch;
  let blocked = false;
  let loseVariantEvidence = false;
  let fetchCount = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), provenance.url, "Only replay the captured merchant PDP");
    fetchCount++;
    const response = new Response(blocked || (loseVariantEvidence && fetchCount > 1) ? "" : html, { status: blocked ? 503 : 200 });
    Object.defineProperty(response, "url", { value: provenance.url });
    return response;
  };
  const item = { key: itemId, title: extractPdpTitle(html, itemId)!, store: "Digihaat", price: 69, productUrl: provenance.url };
  const cfg = { keys: {}, region: "in", language: "en", passcode: null, sessionSecret: null };
  try {
    const [live] = await refreshLivePrices([item], cfg);
    assert.equal(live.status, "live");
    assert.equal(live.livePrice, 69);
    assert.ok(live.verifiedAt && Number.isFinite(Date.parse(live.verifiedAt)));
    loseVariantEvidence = true;
    fetchCount = 0;
    const [ambiguous] = await refreshLivePrices([item], cfg);
    assert.equal(ambiguous.status, "unverified");
    assert.equal(ambiguous.livePrice, null);
    assert.equal(ambiguous.directUrl, undefined);
    loseVariantEvidence = false;
    blocked = true;
    const [unavailable] = await refreshLivePrices([item], cfg);
    assert.equal(unavailable.livePrice, null);
    assert.equal(unavailable.verifiedAt, null);
    const offer = buildGroups([reported(item.title, item.store, item.price)], "INR")[0].offers[0];
    const row = applyLivePrices([offer], { [`${offer.store}-${offer.price}-0`]: unavailable }, "INR")[0];
    assert.equal(row.effectivePrice, 69);
    assert.equal(row.isUnverified, true);
    console.log("PASS Item 5: captured Digihaat RSC selling price/identity, timestamps, blocked-page fallback; Shade 339 stays separate.");
    console.log("Maybelline ₹425 → ₹742 still requires its actual PDP; no guessed link or live-price claim.");
  } finally { globalThis.fetch = savedFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
