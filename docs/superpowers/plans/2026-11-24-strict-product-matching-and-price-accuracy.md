# Strict Product Matching and Price Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix product grouping, retailer link resolution, and price accuracy so that different variants (e.g. 118ml vs 1L) are strictly separated, "Go to Store" links never open a mismatched variant, and retailer prices are accurately verified with timestamps or flagged as "Price needs verification".

**Architecture:**
1. **Strict Product Matching (`src/lib/grouping.ts`)**:
   - Stricten variant signatures: require matching size (extracting from title and URL), volume/weight, multipack, and product form. A size-stated offer cannot merge with a different size, and size-less offers cannot merge across large price differences or into established sized groups.
   - Add variant compatibility validation before merging offers.
2. **Retailer Link Validation & Anti-Mismatch (`src/lib/resolve.ts`)**:
   - Fix `titleMatches` to enforce size and number matching (never treat 118ml and 1L as matching).
   - Check `variantSignature` and price compatibility in `evaluateSeller` and `viaSerpApiExactOfferSearch`.
   - In `Results.tsx`, ensure `pooledIdentities` only pools tokens when offers share identical variant signatures, preventing token cross-contamination between sizes.
3. **Live Price Accuracy & Timestamping (`src/lib/live-price.ts`, `src/lib/types.ts`)**:
   - Add `verifiedAt: string` to `RefreshPricesResult`.
   - Enforce `cache: "no-store"` on fetch calls so stale HTTP caches are never presented as live.
   - Cross-check live scraped price with expected offer price: if the live price diverges radically (e.g. 2.5x+ due to variant switch on site), flag as unverified rather than showing an incorrect price.
4. **UI Presentation (`src/components/Results.tsx`, `src/lib/detail-pricing.ts`)**:
   - Display verified timestamp (e.g. "Verified just now" / "Verified at ...") for live verified prices.
   - When retailer page price cannot be verified, display "Price needs verification".
   - Clearly distinguish verified live price, snapshot price, and unverified price.

**Tech Stack:** Next.js 15, TypeScript, React, Node.js (Termux).

---

## Tasks

### Task 1: Strict Variant Matching in `src/lib/grouping.ts`
- [ ] Stricten `extractSize` and `variantSignature`: improve parsing for sizes like "1L", "1 L", "1000ml", "118ml", "118 ml", "125ml", "500ml", etc.
- [ ] Enforce strict variant matching:
  - Offers with known sizes must match exact size.
  - An offer without stated size must never merge with a size-stated offer if the price ratio exceeds 1.5x, or if the size-less title does not exactly match.
  - Stated variants (e.g. 118ml vs 1L) must never be in the same group.
- [ ] Add unit tests in `scripts/check-grouping.ts` verifying Cetaphil 118ml (₹362), 1L (₹1747), and ₹197 offers do not combine into the same group.

### Task 2: Retailer Link Resolution and Variant Integrity in `src/lib/resolve.ts`
- [ ] Fix `titleMatches` in `src/lib/resolve.ts`:
  - Do not strip numbers or units when comparing product titles.
  - Require that if both titles have sizes or numbers, they must match.
- [ ] In `evaluateSeller`, pass `req.price` and check price range tolerance (e.g. within reason, reject a 1L price of ₹1747 for a ₹362 118ml offer).
- [ ] In `viaSerpApiExactOfferSearch`, validate candidate size against wanted offer size before accepting the link.
- [ ] In `src/components/Results.tsx`, scope `pooledIdentities` strictly to offers having the same size and variant signature.

### Task 3: Live Price Verification, Validation, and Timestamp in `src/lib/live-price.ts`
- [ ] Update `RefreshPricesResult` in `src/lib/types.ts` to include `verifiedAt: string | null` and `status: "live" | "unverified" | "unavailable"`.
- [ ] In `src/lib/live-price.ts`:
  - Set `cache: "no-store"` on `fetchPageText`.
  - Validate extracted price against expected offer price: if the extracted page price is for a different variant (e.g. 2.5x higher or lower), return `status: "unverified"`.
  - Populate `verifiedAt: new Date().toISOString()` when live price is successfully verified.

### Task 4: UI Updates for Price Status & Verification in `src/components/Results.tsx` & `src/lib/detail-pricing.ts`
- [ ] Update `DetailRow` and `applyLivePrices` in `src/lib/detail-pricing.ts` to support `verifiedAt` and `status`.
- [ ] In `StoreRows` in `src/components/Results.tsx`:
  - Show "Price needs verification" when the status is `unverified` or cannot be confirmed on the merchant page.
  - Show "Live" with timestamp (e.g. "Verified just now" or time) when live price is confirmed.
  - Show the snapshot price with clear indicator when unverified.
- [ ] Update unit tests in `scripts/check-detail-pricing.ts` to cover `verifiedAt` and `unverified` status.

### Task 5: End-to-End Verification and Testing
- [ ] Run `npm run check:detail-pricing`.
- [ ] Run `npm run check:grouping`.
- [ ] Run `npm run check:live-price`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Inspect `git diff` carefully to ensure no unrelated changes are touched.
