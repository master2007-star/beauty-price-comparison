# Beauty Price Comparison (standalone)

A standalone, deployable beauty price comparison app. Search once, and it queries
Google Shopping through up to four providers in parallel, groups listings by the
exact product variant (same size, pack count, SPF and form), and shows every
store's price side by side — lowest first, with the saving spelled out.

This is a fresh, self-contained Next.js (App Router + TypeScript) implementation.
It has no dependency on any other codebase.

## How it works

- **Search** — `POST /api/search` fans out to every configured provider, merges
  and dedupes offers, groups them into same-variant products, and returns
  groups + a flat lowest-first offer list.
- **Grouping** — same Google catalog id **and** same variant signature, or same
  brand + strong title overlap + same variant signature. Anything unsure splits
  into its own group. Sizes are strict with unit normalisation
  (16 fl oz = 473 ml).
- **Direct links** — `POST /api/resolve-links` tries SerpApi's
  `google_immersive_product` engine (by `immersive_product_page_token`,
  up to 3 tokens) and SearchApi's `google_product_offers` engine (via
  `product_token`, up to 3 tokens). A seller only counts when the store
  name matches; otherwise the UI falls back honestly to the Google
  Shopping product page and says so. (The old SerpApi `google_product`
  id route is retired and is never called.)
- **Deep compare** — `POST /api/compare` runs up to 3 queries and aligns
  products across them (catalog-anchored, size-strict).
- **Status** — `GET /api/status` reports region, language, lock state and per
  provider configured/last-4 only. Full keys are never exposed.
- **App lock (optional)** — when `APP_PASSCODE` is set, a passcode gate covers
  the app and its APIs. Verification is server-side with a constant-time
  compare, sessions are HMAC-signed HttpOnly cookies, and 5 wrong tries lock a
  visitor out for 5 minutes. When unset, there is no lock screen at all.
- **Honesty** — if no provider key is configured, the UI says plainly which
  environment variables to set. Provider failures surface as warnings, never as
  fake data. No prices, stores or results are ever invented.

## Environment variables

Copy `.env.example` to `.env.local` for local development. On Vercel, set them
under Project → Settings → Environment Variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SERPAPI_KEY` | At least one provider | SerpApi key (serpapi.com) |
| `SEARCHAPI_KEY` | At least one provider | SearchApi.io key (searchapi.io) |
| `SERPER_KEY` | At least one provider | Serper key (serper.dev) |
| `SEARLO_KEY` | At least one provider | Searlo key (searlo.tech) |
| `REGION` | No (default `in`) | Google Shopping country (`gl`) |
| `LANGUAGE` | No (default `en`) | Google Shopping language (`hl`) |
| `APP_PASSCODE` | No | Optional app-lock passcode |
| `SESSION_SECRET` | No | Optional cookie signing secret (derived from the passcode when unset) |
| `AUTH_GOOGLE_ID` | No | Optional Google login: OAuth client ID (see below) |
| `AUTH_GOOGLE_SECRET` | No | Optional Google login: OAuth client secret (see below) |
| `AUTH_SECRET` | No | Optional Google login: random string for signing session cookies |

## Google login (optional)

Signing in is optional — the site works exactly the same without it. No
route is gated and there is no login wall. When the three `AUTH_*`
variables below are all set, a "Sign in with Google" pill appears in the
top bar and a `/login` page is available; without them, no login UI is
shown at all. Sessions use Auth.js v5 JWT cookies — there is no database
and no user table. This is separate from the `APP_PASSCODE` app lock.

Setup (the person deploying does this; no credentials live in the code):

1. In [Google Cloud Console](https://console.cloud.google.com/), create
   a project (or reuse one) and configure the **OAuth consent screen**
   (User type: External).
2. Go to **Credentials → Create Credentials → OAuth client ID**,
   application type **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   `https://beauty-price-comparison.vercel.app/api/auth/callback/google`
4. Copy the generated **Client ID** and **Client secret**.
5. In Vercel → Project → Settings → Environment Variables, set:
   - `AUTH_GOOGLE_ID` = the Client ID
   - `AUTH_GOOGLE_SECRET` = the Client secret
   - `AUTH_SECRET` = any long random string (e.g. `openssl rand -base64 32`)
6. Redeploy. The sign-in pill appears in the top bar.

For local development, the same three variables go in `.env.local`, and
the redirect URI registered in Google Cloud Console must be
`http://localhost:3000/api/auth/callback/google` instead.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in at least one provider key
npm run dev                  # http://localhost:3000
```

Verify the grouping engine without any keys or network:

```bash
npm run check:grouping
```

## Deploy to Vercel

1. Push this folder to a Git repository (GitHub, GitLab or Bitbucket).
2. In Vercel, **Add New → Project**, and import the repository.
3. Vercel auto-detects Next.js — keep the defaults (build command `next build`,
   output directory `.next`).
4. Before deploying, add your environment variables under **Settings →
   Environment Variables** (at least one provider key; see the table above).
5. Click **Deploy**. The app is live on the assigned `*.vercel.app` domain.

To deploy without git: `npm i -g vercel`, then `vercel` from this folder and
follow the prompts, adding env vars with `vercel env add` first.

## Provider notes

Request/response formats follow each provider's published documentation
(checked November 2026):

- **SerpApi** — `GET serpapi.com/search?engine=google_shopping` reads
  `shopping_results[]` (capturing each result's
  `immersive_product_page_token`); `engine=google_immersive_product&
  page_token=…&more_stores=true` reads `product_results.stores[]`.
- **SearchApi.io** — `GET searchapi.io/api/v1/search?engine=google_shopping`
  reads `shopping_results[]` (plus `shopping_ads[]`); `engine=google_product_offers`
  requires a `product_token` minted by the shopping call (since their May 2026
  breaking change, `product_id` is no longer accepted there) and reads `offers[]`.
- **Serper** — `POST google.serper.dev/shopping` with the `X-API-KEY` header
  reads `shopping[]`. Note: each call spends credits.
- **Searlo** — `GET api.searlo.tech/api/v1/search/shopping` with the `x-api-key`
  header, following Searlo's documented `/search/*` REST pattern and the
  `q`/`gl`/`hl`/`limit` parameters used by its other search endpoints.
  ⚠️ The shopping endpoint's exact path and response keys could not be fully
  confirmed from Searlo's public docs index, so the client parses defensively
  (accepting `shopping`, `results`, `products` or `organic` arrays) and reports
  any mismatch as a provider error. Run one live search after deploying to
  confirm Searlo returns results; if it errors, the other providers keep
  working and the error names Searlo explicitly.

## Frontend notes

- Cream/serif/editorial design with Framer Motion throughout: parallax hero,
  staggered headline, glass hero pills and cards, glassy sticky and hero
  search bars, reading-progress bar, store marquee, category bento, animated
  stat count-ups, FAQ accordion and an animated compare modal.
- **Motion safety rule:** below-fold entrances are transform-only (no opacity
  gated on scroll-into-view), so no control can ever sit invisible. The UI
  respects `prefers-reduced-motion`.
- The three stat cards are fixed numbers matching the reference design (4 live
  price sources, 18 major stores tracked, 100% variant-matched groups). They
  describe the comparison, not a live measurement; the results header shows
  which stores actually listed each product.
- Fonts are self-hosted via `next/font` (Fraunces, Inter, IBM Plex Mono) — the
  build never depends on a runtime font CDN.
