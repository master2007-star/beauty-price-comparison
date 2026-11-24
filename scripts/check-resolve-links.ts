/**
 * Fixture-based verification for the identity-free direct-link
 * resolution (the Shopsy case): SerpApi google_shopping links arrive
 * as Google redirects, and the last-resort exact-offer search must
 * resolve them to the merchant PDP. No network, no provider keys —
 * global fetch is stubbed with canned SerpApi payloads.
 * Run: npm run check:resolve-links
 */
import { resolveDirectLink } from "../src/lib/resolve";
import type { AppConfig } from "../src/lib/env";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SHOPSY_PDP =
  "https://www.shopsy.in/tlismi-ordinary-niacinamide-10-zinc-1-serum-helps-minimize-pore-appearance/p/itm3cf82faad2fb4?pid=ABC123";
const SHOPSY_REDIRECT =
  "https://www.google.com/url?q=" + encodeURIComponent(SHOPSY_PDP) + "&sa=U&ved=2ahUKEw";
const GOOGLE_SHOPPING_PAGE = "https://www.google.com/shopping/product/1234567890?gl=in";

const TITLE = "The Ordinary Niacinamide 10% + Zinc 1%";
const STORE = "Shopsy By Flipkart";

/* Canned SerpApi google_shopping payloads, swapped per case. */
let currentSerpApiPayload: Record<string, unknown> = { shopping_results: [] };
let currentSearloPayload: Record<string, unknown> = { shopping: [] };
let serpApi429 = false;
let lastSerpApiQuery = "";

let lastSearloQuery = "";
let lastSearloKey: string | null = null;

(globalThis as any).fetch = async (input: unknown, init?: any) => {
  const url = String(input);
  if (url.startsWith("https://serpapi.com/search.json")) {
    lastSerpApiQuery = new URL(url).searchParams.get("q") ?? "";
    if (serpApi429) {
      return { ok: false, status: 429, url, json: async () => ({ error: "Your account has run out of searches" }) };
    }
    return { ok: true, status: 200, url, json: async () => currentSerpApiPayload };
  }
  if (url.startsWith("https://api.searlo.tech/api/v1/search/shopping")) {
    lastSearloQuery = new URL(url).searchParams.get("q") ?? "";
    lastSearloKey = (init?.headers as any)?.["x-api-key"] ?? null;
    return { ok: true, status: 200, url, json: async () => currentSearloPayload };
  }
  // Any other fetch (a redirect follow): echo the URL, so a Google
  // URL stays a Google URL and the merchant check rejects it.
  return { ok: true, status: 200, url, json: async () => ({}) };
};

const cfg: AppConfig = {
  keys: { serpapi: "test-key", searlo: "test-searlo-key" },
  region: "in",
  language: "en",
  passcode: null,
  sessionSecret: null,
};

const req = {
  title: TITLE,
  store: STORE,
  price: 330,
  productUrl: GOOGLE_SHOPPING_PAGE,
};

async function main() {
  /* Case 1: Shopsy candidate behind a Google redirect (/url?q=<PDP>). */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: SHOPSY_REDIRECT,
        extracted_price: 330,
      },
      {
        source: "Nykaa",
        title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: "https://www.nykaa.com/the-ordinary-niacinamide-10-zinc-1-serum/p/123",
        extracted_price: 500,
      },
    ],
  };
  const hit = await resolveDirectLink(req, cfg);
  check("Shopsy redirect resolves to the shopsy.in PDP", hit.directUrl === SHOPSY_PDP, `got ${hit.directUrl}`);
  check("matched store is Shopsy", hit.matchedStore === "Shopsy", `got ${hit.matchedStore}`);
  check("source is serpapi", hit.source === "serpapi", `got ${hit.source}`);
  check("query drops the 'By Flipkart' parent clause", lastSerpApiQuery === `${TITLE} Shopsy`, `got ${lastSerpApiQuery}`);

  /* Case 2: same store+title, but the link is a bare Google Shopping page — must be rejected. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: GOOGLE_SHOPPING_PAGE,
        extracted_price: 330,
      },
    ],
  };
  const noPage = await resolveDirectLink(req, cfg);
  check("Google Shopping page link is never returned", noPage.directUrl === null, `got ${noPage.directUrl}`);

  /* Case 3: no Shopsy candidate at all — honest failure, no wrong link. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Nykaa",
        title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: "https://www.nykaa.com/the-ordinary-niacinamide-10-zinc-1-serum/p/123",
        extracted_price: 500,
      },
    ],
  };
  const noSeller = await resolveDirectLink(req, cfg);
  check("no matching seller returns null, not a wrong store", noSeller.directUrl === null, `got ${noSeller.directUrl}`);

  /* Case 4: direct merchant link passes through unchanged. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: SHOPSY_PDP,
        extracted_price: 330,
      },
    ],
  };
  const direct = await resolveDirectLink(req, cfg);
  check("direct merchant link passes through", direct.directUrl === SHOPSY_PDP, `got ${direct.directUrl}`);

  /* Case 5: candidate price far from the clicked offer is rejected. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: SHOPSY_REDIRECT,
        extracted_price: 6999,
      },
    ],
  };
  const wrongPrice = await resolveDirectLink(req, cfg);
  check("price-mismatched candidate is rejected", wrongPrice.directUrl === null, `got ${wrongPrice.directUrl}`);

  /* Case 6: product_link carries the PDP when link is a Google page. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: GOOGLE_SHOPPING_PAGE,
        product_link: SHOPSY_PDP,
        extracted_price: 330,
      },
    ],
  };
  const viaProductLink = await resolveDirectLink(req, cfg);
  check("product_link PDP is used when link is a Google page", viaProductLink.directUrl === SHOPSY_PDP, `got ${viaProductLink.directUrl}`);

  /* Case 7: THE live situation — SerpApi quota exhausted (429), Searlo
   * returns the Shopsy candidate with a direct merchant link. */
  serpApi429 = true;
  currentSearloPayload = {
    shopping: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: SHOPSY_PDP,
        extracted_price: 330,
      },
    ],
  };
  const viaSearlo = await resolveDirectLink(req, cfg);
  check("SerpApi 429 falls back to Searlo and resolves", viaSearlo.directUrl === SHOPSY_PDP, `got ${viaSearlo.directUrl}`);
  check("fallback source is searlo", viaSearlo.source === "searlo", `got ${viaSearlo.source}`);
  check("Searlo request carries the x-api-key header", lastSearloKey === "test-searlo-key", `got ${lastSearloKey}`);
  check("Searlo query drops the 'By Flipkart' parent clause", lastSearloQuery === `${TITLE} Shopsy`, `got ${lastSearloQuery}`);
  serpApi429 = false;

  /* Case 8: SerpApi answers but has no match; Searlo has the Shopsy
   * candidate behind a Google redirect. */
  currentSerpApiPayload = {
    shopping_results: [
      {
        source: "Nykaa",
        title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: "https://www.nykaa.com/the-ordinary-niacinamide-10-zinc-1-serum/p/123",
        extracted_price: 500,
      },
    ],
  };
  currentSearloPayload = {
    shopping: [
      {
        source: "Shopsy",
        title: "Tlismi Ordinary Niacinamide 10% + Zinc 1% Serum 30ml",
        link: SHOPSY_REDIRECT,
        extracted_price: 330,
      },
    ],
  };
  const viaSearloRedirect = await resolveDirectLink(req, cfg);
  check("Searlo redirect resolves when SerpApi has no match", viaSearloRedirect.directUrl === SHOPSY_PDP, `got ${viaSearloRedirect.directUrl}`);

  /* Case 9: neither provider has the Shopsy candidate — honest failure. */
  currentSerpApiPayload = { shopping_results: [] };
  currentSearloPayload = { shopping: [] };
  const neither = await resolveDirectLink(req, cfg);
  check("no match on either provider returns null", neither.directUrl === null, `got ${neither.directUrl}`);

  console.log(failures === 0 ? "\nAll resolve-links checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
