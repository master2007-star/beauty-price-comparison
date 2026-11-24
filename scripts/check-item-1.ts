/** Offline replay of observations captured on 2026-11-24; no live API calls. */
import assert from "node:assert/strict";
import fixture from "./fixtures/observed-ordinary.json";
import { POST } from "../src/app/api/resolve-links/route";

async function main() {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.SERPAPI_KEY;
  const savedPasscode = process.env.APP_PASSCODE;
  process.env.SERPAPI_KEY = "offline-regression";
  delete process.env.APP_PASSCODE;
  const engines: string[] = [];
  let webOnly = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "serpapi.com", "No Google search page or live merchant fetch");
    const engine = url.searchParams.get("engine")!;
    engines.push(engine);
    assert.ok(url.searchParams.get("q")?.includes(fixture.amazon.title));
    const candidate = {
      source: fixture.amazon.store, title: fixture.amazon.title,
      link: fixture.amazon.directUrl, extracted_price: fixture.amazon.price,
    };
    return Response.json(engine === "google"
      ? { organic_results: [candidate] }
      : { shopping_results: webOnly ? [] : [candidate] });
  };
  try {
    const request = () => new Request("http://localhost/api/resolve-links", {
      method: "POST", body: JSON.stringify({ ...fixture.amazon, directUrl: undefined }),
    });
    const response = await POST(request());
    assert.equal((await response.json()).directUrl, fixture.amazon.directUrl);
    assert.deepEqual(engines, ["google_shopping"]);
    engines.length = 0;
    webOnly = true;
    const webResponse = await POST(request());
    assert.equal((await webResponse.json()).directUrl, fixture.amazon.directUrl);
    assert.deepEqual(engines, ["google_shopping", "google"]);
    assert.ok(fixture.shopsy.productUrl.includes("ibp=oshop"));
    console.log("PASS Item 1: token-free API requests reach exact-offer search; Shopping and web PDP results resolve.");
    console.log("Recorded Shopsy ₹330 remains a live verification case; this replay does not claim a live Shopsy pass.");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.SERPAPI_KEY; else process.env.SERPAPI_KEY = savedKey;
    if (savedPasscode === undefined) delete process.env.APP_PASSCODE; else process.env.APP_PASSCODE = savedPasscode;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
