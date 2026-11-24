# Graph Report - Beauty  (2026-11-24)

## Corpus Check
- 88 files · ~64,485 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .css 2, .example 1, (none) 1)

## Summary
- 819 nodes · 1924 edges · 24 communities (21 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9860377f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- check-grouping.ts
- db.ts
- resolve.ts
- grouping.ts
- types.ts
- live-price.ts
- check-beauty-filter.ts
- check-detail-pricing.ts
- package.json
- Results.tsx
- lock.ts
- providers.ts
- getConfig
- layout.tsx
- env.ts
- compilerOptions
- detail-pricing.ts
- app/page.tsx
- search.ts
- Beauty Price Comparison (standalone)
- refresh-prices/route.ts
- next.config.mjs
- vercel.json

## God Nodes (most connected - your core abstractions)
1. `getConfig()` - 25 edges
2. `resolveDirectLink()` - 23 edges
3. `buildGroups()` - 22 edges
4. `runSearch()` - 22 edges
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

## Communities (24 total, 3 thin omitted)

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
Nodes (61): inherited, main(), ABBREV, BODY_PART_WORDS, buildGroups(), BUNDLE_RES, CLAIM_WORDS, coreTokens() (+53 more)

### Community 4 - "types.ts"
Cohesion: 0.07
Nodes (49): capped, classify, general, grounded, group(), rewrite, ten, dynamic (+41 more)

### Community 5 - "live-price.ts"
Cohesion: 0.08
Nodes (38): groups, html, main(), reported(), digihaatClassPrice, digihaatPrice, isOpenableUrl(), StoreButton() (+30 more)

### Community 6 - "check-beauty-filter.ts"
Cohesion: 0.13
Nodes (21): allowedQueries, beauty, blockedQueries, check(), finish(), junk, main(), mixed (+13 more)

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
Cohesion: 0.13
Nodes (26): dynamic, POST(), runtime, dynamic, GET(), runtime, dynamic, POST() (+18 more)

### Community 11 - "providers.ts"
Cohesion: 0.29
Nodes (21): coercePrice(), CURRENCY_SYMBOLS, defaultCurrencyForRegion(), detectCurrency(), parsePriceLabel(), asArray(), asNumber(), asRecord() (+13 more)

### Community 12 - "getConfig"
Cohesion: 0.17
Nodes (16): main(), dynamic, maxDuration, POST(), runtime, dynamic, maxDuration, POST() (+8 more)

### Community 13 - "layout.tsx"
Cohesion: 0.09
Nodes (26): next-auth@^5.0.0-beta.32, next-auth, GET(), notConfigured(), POST(), fraunces, inter, metadata (+18 more)

### Community 14 - "env.ts"
Cohesion: 0.22
Nodes (12): next, dynamic, GET(), runtime, AppConfig, ENV_KEYS, last4(), health (+4 more)

### Community 15 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 16 - "detail-pricing.ts"
Cohesion: 0.15
Nodes (23): Task 4: UI Updates for Price Status & Verification in `src/components/Results.tsx` & `src/lib/detail-pricing.ts`, afterClick, allClicked, failed, firstKey, offers, rows, failed (+15 more)

### Community 17 - "app/page.tsx"
Cohesion: 0.05
Nodes (75): framer-motion, react, HomePage(), loadRecent(), SettingsPage(), lockNow(), AiChat(), send() (+67 more)

### Community 18 - "search.ts"
Cohesion: 0.25
Nodes (13): configuredProviders(), envVarName(), dedupeOffers(), extractQueryBrand(), flattenOffers(), isProviderQuotaExhausted(), recordProviderResult(), PROVIDER_FETCHERS (+5 more)

### Community 19 - "Beauty Price Comparison (standalone)"
Cohesion: 0.20
Nodes (9): Beauty Price Comparison (standalone), Deploy to Vercel, Environment variables, Frontend notes, Gemini AI (optional), Google login (optional), How it works, Local development (+1 more)

### Community 20 - "refresh-prices/route.ts"
Cohesion: 0.28
Nodes (8): asStringArray(), dynamic, maxDuration, POST(), runtime, validItem(), RefreshPricesItem, RefreshPricesRequest

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `env.ts` to `db.ts`, `types.ts`, `package.json`, `lock.ts`, `getConfig`, `layout.tsx`, `app/page.tsx`, `refresh-prices/route.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Should `check-grouping.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.024390243902439025 - nodes in this community are weakly interconnected._
- **Why does `react` connect `app/page.tsx` to `types.ts`, `package.json`, `Results.tsx`, `layout.tsx`, `detail-pricing.ts`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `db.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05017543859649123 - nodes in this community are weakly interconnected._
- **Why does `runSearch()` connect `search.ts` to `db.ts`, `grouping.ts`, `types.ts`, `check-beauty-filter.ts`, `providers.ts`, `getConfig`, `Beauty Price Comparison (standalone)`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Should `resolve.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1037037037037037 - nodes in this community are weakly interconnected._
- **Should `grouping.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06826923076923076 - nodes in this community are weakly interconnected._