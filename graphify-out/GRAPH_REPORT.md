# Graph Report - Beauty  (2026-11-24)

## Corpus Check
- 88 files · ~64,595 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .css 2, .example 1, (none) 1)

## Summary
- 819 nodes · 1933 edges · 25 communities (22 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d5abb37`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- check-grouping.ts
- db.ts
- resolve.ts
- grouping.ts
- types.ts
- live-price.ts
- search.ts
- check-detail-pricing.ts
- package.json
- Results.tsx
- lock.ts
- providers.ts
- getConfig
- isGoogleLoginConfigured
- next
- compilerOptions
- detail-pricing.ts
- app/page.tsx
- layout.tsx
- Beauty Price Comparison (standalone)
- lock/status/route.ts
- resolve-links/route.ts
- next.config.mjs
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `getConfig()` - 25 edges
2. `resolveDirectLink()` - 23 edges
3. `runSearch()` - 22 edges
4. `buildGroups()` - 22 edges
5. `next` - 20 edges
6. `HomePage()` - 19 edges
7. `isDatabaseConfigured()` - 18 edges
8. `isAuthorized()` - 18 edges
9. `react` - 17 edges
10. `compilerOptions` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Gemini AI (optional)` --references--> `runSearch()`  [INFERRED]
  README.md → src/lib/search.ts
- `Strict Product Matching and Price Accuracy Implementation Plan` --references--> `RefreshPricesResult`  [INFERRED]
  docs/superpowers/plans/2026-11-24-strict-product-matching-and-price-accuracy.md → src/lib/types.ts
- `Task 3: Live Price Verification, Validation, and Timestamp in `src/lib/live-price.ts`` --references--> `RefreshPricesResult`  [INFERRED]
  docs/superpowers/plans/2026-11-24-strict-product-matching-and-price-accuracy.md → src/lib/types.ts
- `Task 1: Strict Variant Matching in `src/lib/grouping.ts`` --references--> `extractSize()`  [INFERRED]
  docs/superpowers/plans/2026-11-24-strict-product-matching-and-price-accuracy.md → src/lib/grouping.ts
- `Strict Product Matching and Price Accuracy Implementation Plan` --references--> `variantSignature()`  [INFERRED]
  docs/superpowers/plans/2026-11-24-strict-product-matching-and-price-accuracy.md → src/lib/grouping.ts

## Import Cycles
- None detected.

## Communities (25 total, 3 thin omitted)

### Community 0 - "check-grouping.ts"
Cohesion: 0.02
Nodes (77): acneSplit, bimodalOutlier, bothBrandless, brandlessFixtures, brandlessFormSplit, brandlessMerged, brandlessNoQuery, brandlessSizeSplit (+69 more)

### Community 1 - "db.ts"
Cohesion: 0.05
Nodes (62): history, nextDay, sameDay, snapshots, check(), finish(), now, oneHourAgo (+54 more)

### Community 2 - "resolve.ts"
Cohesion: 0.10
Nodes (52): Strict Product Matching and Price Accuracy Implementation Plan, Task 1: Strict Variant Matching in `src/lib/grouping.ts`, Task 2: Retailer Link Resolution and Variant Integrity in `src/lib/resolve.ts`, Task 3: Live Price Verification, Validation, and Timestamp in `src/lib/live-price.ts`, Task 5: End-to-End Verification and Testing, Tasks, cfg, check() (+44 more)

### Community 3 - "grouping.ts"
Cohesion: 0.07
Nodes (59): inherited, main(), ABBREV, BODY_PART_WORDS, buildGroups(), BUNDLE_RES, CLAIM_WORDS, coreTokens() (+51 more)

### Community 4 - "types.ts"
Cohesion: 0.07
Nodes (49): capped, classify, general, grounded, group(), rewrite, ten, dynamic (+41 more)

### Community 5 - "live-price.ts"
Cohesion: 0.07
Nodes (40): groups, html, main(), reported(), digihaatClassPrice, digihaatPrice, isOpenableUrl(), StoreButton() (+32 more)

### Community 6 - "search.ts"
Cohesion: 0.08
Nodes (45): allowedQueries, beauty, blockedQueries, check(), finish(), junk, main(), mixed (+37 more)

### Community 7 - "check-detail-pricing.ts"
Cohesion: 0.05
Nodes (37): allFailingLive, allFailingOffers, allFailingRows, emptyThumb, f4Live, f4Offers, f4Rows, f4Stats (+29 more)

### Community 8 - "package.json"
Cohesion: 0.07
Nodes (35): dependencies, framer-motion@^12.0.0, next@^15.0.0, react@^19.0.0, react-dom@^19.0.0, @vercel/postgres@^0.10.0, description, devDependencies (+27 more)

### Community 9 - "Results.tsx"
Cohesion: 0.13
Nodes (21): getProductThumbSource(), GroupCard(), PriceHistoryData, PriceHistorySection(), ProductDetail(), ProductPlaceholderIcon(), ProductThumb(), Results() (+13 more)

### Community 10 - "lock.ts"
Cohesion: 0.24
Nodes (14): dynamic, POST(), runtime, attempts, AttemptState, clearAttempts(), clientKeyFromRequest(), isLockedOut() (+6 more)

### Community 11 - "providers.ts"
Cohesion: 0.29
Nodes (21): coercePrice(), CURRENCY_SYMBOLS, defaultCurrencyForRegion(), detectCurrency(), parsePriceLabel(), asArray(), asNumber(), asRecord() (+13 more)

### Community 12 - "getConfig"
Cohesion: 0.16
Nodes (18): dynamic, maxDuration, POST(), runtime, asStringArray(), dynamic, maxDuration, POST() (+10 more)

### Community 13 - "isGoogleLoginConfigured"
Cohesion: 0.17
Nodes (14): next-auth@^5.0.0-beta.32, next-auth, GET(), notConfigured(), POST(), ERROR_MESSAGES, LoginPage(), auth (+6 more)

### Community 14 - "next"
Cohesion: 0.40
Nodes (5): next, dynamic, POST(), runtime, clearSessionCookieHeader()

### Community 15 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 16 - "detail-pricing.ts"
Cohesion: 0.15
Nodes (23): Task 4: UI Updates for Price Status & Verification in `src/components/Results.tsx` & `src/lib/detail-pricing.ts`, afterClick, allClicked, failed, firstKey, offers, rows, failed (+15 more)

### Community 17 - "app/page.tsx"
Cohesion: 0.05
Nodes (80): framer-motion, react, HomePage(), loadRecent(), SettingsPage(), lockNow(), AiChat(), send() (+72 more)

### Community 18 - "layout.tsx"
Cohesion: 0.23
Nodes (7): fraunces, inter, metadata, plexMono, RootLayout(), AuthSessionProvider(), ProgressBar()

### Community 19 - "Beauty Price Comparison (standalone)"
Cohesion: 0.20
Nodes (9): Beauty Price Comparison (standalone), Deploy to Vercel, Environment variables, Frontend notes, Gemini AI (optional), Google login (optional), How it works, Local development (+1 more)

### Community 20 - "lock/status/route.ts"
Cohesion: 0.31
Nodes (8): dynamic, GET(), runtime, b64url(), createSessionCookieValue(), isLockEnabled(), isValidSession(), signingSecret()

### Community 21 - "resolve-links/route.ts"
Cohesion: 0.32
Nodes (6): main(), dynamic, maxDuration, POST(), runtime, ResolveLinksRequest

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `next` to `db.ts`, `types.ts`, `search.ts`, `package.json`, `lock.ts`, `getConfig`, `isGoogleLoginConfigured`, `app/page.tsx`, `layout.tsx`, `lock/status/route.ts`, `resolve-links/route.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Should `check-grouping.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.024390243902439025 - nodes in this community are weakly interconnected._
- **Why does `react` connect `app/page.tsx` to `types.ts`, `package.json`, `Results.tsx`, `isGoogleLoginConfigured`, `detail-pricing.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05017543859649123 - nodes in this community are weakly interconnected._
- **Why does `runSearch()` connect `search.ts` to `db.ts`, `grouping.ts`, `types.ts`, `providers.ts`, `getConfig`, `Beauty Price Comparison (standalone)`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `resolve.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1037037037037037 - nodes in this community are weakly interconnected._
- **Should `grouping.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0706605222734255 - nodes in this community are weakly interconnected._