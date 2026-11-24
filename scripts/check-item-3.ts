import assert from "node:assert/strict";
import fixture from "./fixtures/observed-ordinary.json";
import { resolveDirectLink, titleMatches } from "../src/lib/resolve";
import { extractPdpTitle, matchesRequiredVariant, requiredVariantTitle, statedVariantsConflict } from "../src/lib/variant-validation";
import { pooledIdentities } from "../src/lib/resolution-request";
import type { AppConfig } from "../src/lib/env";
import type { Offer } from "../src/lib/types";

// Product/variant descriptions supplied in the reported Purplle failure.
const wanted = "Maybelline Fit Me Matte Poreless Foundation 30 ml Fair Porcelain";
const wrong = "Maybelline New York Fit Me Matte+Poreless Liquid Foundation Tube, 128 Warm Nude, 18 ml";
const right = "Maybelline New York Fit Me Matte+Poreless Liquid Foundation Fair Porcelain 30 ml";
assert.equal(titleMatches(wanted, wrong), false);
assert.equal(titleMatches(wanted, right), true);
const shortTitle = "Maybelline Fit Me Matte Poreless Foundation";
const inherited = requiredVariantTitle(shortTitle, [right]);
assert.equal(matchesRequiredVariant(inherited, right), true);
assert.equal(matchesRequiredVariant(inherited, wrong), false);
assert.equal(statedVariantsConflict(wanted, wrong), true);
assert.equal(matchesRequiredVariant(wanted, "Maybelline Fit Me Matte Poreless Foundation"), false);
assert.equal(matchesRequiredVariant(wanted, wanted.replace("30 ml ", "")), false);
assert.equal(matchesRequiredVariant(wanted, wanted.replace("Fair Porcelain", "")), false);
assert.equal(extractPdpTitle("<title>Link unavailable</title>"), "Link unavailable");

async function main() {
  const savedFetch = globalThis.fetch;
  const cfg: AppConfig = { keys: { serpapi: "offline-regression", searchapi: "offline-regression" }, region: "in", language: "en", passcode: null, sessionSecret: null };
  // Reuse the observed Amazon PDP/offer. Missing PDP attributes must fail
  // regardless of which pooled identity or redirect found that URL.
  const observed = fixture.offers.find((offer) => offer.store === fixture.amazon.store)! as Offer;
  const pool = pooledIdentities(observed, fixture.offers as Offer[], wanted);
  assert.deepEqual(pool.immersiveTokens, observed.immersiveToken ? [observed.immersiveToken] : []);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("serpapi.com")) return Response.json({ product_results: { stores: [{ name: observed.store, link: fixture.amazon.directUrl, extracted_price: observed.price }] } });
    if (url.includes("searchapi.io")) return Response.json({ product: { product_token: observed.immersiveToken }, offers: [{ merchant: { name: observed.store }, link: fixture.amazon.directUrl, extracted_price: observed.price }] });
    // An empty retailer response provides no size/shade evidence.
    const response = new Response("");
    Object.defineProperty(response, "url", { value: fixture.amazon.directUrl });
    return response;
  };
  try {
    const base = { title: observed.title, groupTitle: wanted, store: observed.store, price: observed.price };
    for (const identities of [
      { immersiveTokens: observed.immersiveToken ? [observed.immersiveToken] : [] },
      { productTokens: observed.immersiveToken ? [observed.immersiveToken] : [] },
      { productIds: observed.productId ? [observed.productId] : [] },
      { productUrl: fixture.amazon.directUrl },
    ]) {
      assert.equal((await resolveDirectLink({ ...base, ...identities }, cfg)).directUrl, null);
    }
    console.log("PASS Item 3: exact size AND shade required; pooled/token/id/direct paths reject ambiguous PDPs.");
  } finally { globalThis.fetch = savedFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
