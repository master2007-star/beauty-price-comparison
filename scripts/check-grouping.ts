/**
 * Fixture-based verification for the grouping engine.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:grouping
 */
import { buildGroups, computeGroupSavings, dedupeOffers, extractBrand, extractMultipack, extractQueryBrand, extractSize, hasBundleMismatch, hasDistinctiveTokens, isBundleTitle, sizesMatch } from "../src/lib/grouping";
import type { RawOffer } from "../src/lib/types";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function offer(partial: Partial<RawOffer> & { title: string; store: string; price: number }): RawOffer {
  return {
    priceLabel: null,
    currency: "INR",
    provider: "serpapi",
    productUrl: null,
    directUrl: null,
    rating: null,
    reviews: null,
    imageUrl: null,
    catalogId: null,
    productId: null,
    productToken: null,
    immersiveToken: null,
    ...partial,
  };
}

/* ------------------------- unit normalisation ------------------------- */

const flOz = extractSize("CeraVe Moisturising Lotion 16 fl oz");
const ml = extractSize("CeraVe Moisturising Lotion 473 ml");
check("16 fl oz parses as volume", flOz?.kind === "volume");
check("16 fl oz ≈ 473 ml", flOz !== null && ml !== null && sizesMatch(flOz, ml), `${flOz?.value} vs ${ml?.value}`);
check("50 ml ≠ 100 ml", !sizesMatch(extractSize("Serum 50 ml"), extractSize("Serum 100 ml")));
check("volume ≠ weight", !sizesMatch(extractSize("Cream 50 ml"), extractSize("Cream 50 g")));
check("1 oz (weight) ≈ 28.35 g", sizesMatch(extractSize("Balm 1 oz"), extractSize("Balm 28 g")));

/* ------------------------------ grouping ------------------------------ */

const fixtures: RawOffer[] = [
  // Same product + variant, three stores → one group.
  offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Nykaa", price: 550, catalogId: "CAT1" }),
  offer({ title: "CeraVe Moisturising Cream 50ml", store: "Amazon.in", price: 499, catalogId: "CAT1" }),
  offer({ title: "CeraVe Moisturising Cream - 50 ml", store: "Purplle", price: 620, catalogId: "CAT1" }),
  // Same product, different size → separate group.
  offer({ title: "CeraVe Moisturising Cream 100 ml", store: "Nykaa", price: 899, catalogId: "CAT1" }),
  // Unit normalisation: 16 fl oz == 473 ml → same group.
  offer({ title: "CeraVe Moisturising Lotion 16 fl oz", store: "Amazon.in", price: 1100 }),
  offer({ title: "CeraVe Moisturising Lotion 473 ml", store: "Nykaa", price: 1050 }),
  // Multipack splits.
  offer({ title: "Pilgrim Vitamin C Serum 30 ml", store: "Nykaa", price: 450 }),
  offer({ title: "Pilgrim Vitamin C Serum 30 ml Pack of 2", store: "Amazon.in", price: 799 }),
  // SPF splits.
  offer({ title: "La Roche-Posay Anthelios SPF 30 50 ml", store: "Nykaa", price: 950 }),
  offer({ title: "La Roche-Posay Anthelios SPF 50 50 ml", store: "Nykaa", price: 1050 }),
  // Form splits: serum vs cream.
  offer({ title: "Minimalist Niacinamide Serum 30 ml", store: "Nykaa", price: 545 }),
  offer({ title: "Minimalist Niacinamide Cream 30 ml", store: "Nykaa", price: 499 }),
  // Different brands, similar words → separate.
  offer({ title: "Vitamin C Face Serum 30 ml", store: "Mamaearth", price: 399 }),
  offer({ title: "Vitamin C Face Serum 30 ml", store: "Plum", price: 420 }),
];

const groups = buildGroups(dedupeOffers(fixtures), "INR");
const titles = groups.map((g) => g.title);
console.log(`\n${groups.length} groups from ${fixtures.length} fixtures:`);
for (const g of groups) {
  console.log(`  - ${g.title} | ${g.storeCount} stores | ${g.lowestLabel}–${g.highestLabel}`);
}

check("total groups == 11", groups.length === 11, `got ${groups.length}: ${titles.join(" / ")}`);
const cerave50 = groups.find((g) => g.title.includes("CeraVe Moisturising Cream 50"));
check("CeraVe 50 ml merged across 3 stores", cerave50?.storeCount === 3, `storeCount=${cerave50?.storeCount}`);
check("CeraVe 50 ml cheapest flagged", cerave50?.offers[0].isCheapest === true && cerave50?.offers[0].price === 499);
check("CeraVe 50 ml delta label on 2nd offer", (cerave50?.offers[1].deltaLabel ?? "").includes("vs lowest"));
check("CeraVe 100 ml is its own group", groups.some((g) => g.title.includes("100 ml") && g.storeCount === 1));
const lotion = groups.find((g) => g.title.includes("Moisturising Lotion"));
check("16 fl oz + 473 ml merged", lotion?.storeCount === 2, `storeCount=${lotion?.storeCount}`);
check("multipack split", groups.filter((g) => g.title.includes("Pilgrim")).length === 2);
check("Pilgrim single is its own group", groups.some((g) => g.title === "Pilgrim Vitamin C Serum 30 ml" && g.storeCount === 1));
check("SPF split", groups.filter((g) => g.title.includes("Anthelios")).length === 2);
check("form split (serum vs cream)", groups.filter((g) => g.title.includes("Minimalist")).length === 2);
check("different brands split", groups.filter((g) => g.title === "Vitamin C Face Serum 30 ml").length === 2);
/* Ordering: multi-store groups first, lowest price within each tier
 * (this replaces the old flat lowest-first expectation). */
const tierOrderOk = (() => {
  let seenSingle = false;
  for (const g of groups) {
    if (g.storeCount === 1) seenSingle = true;
    else if (seenSingle) return false;
  }
  return true;
})();
check("multi-store groups sort before single-store groups", tierOrderOk);
const tierSorted = (tier: typeof groups) =>
  tier.every((g, i) => i === 0 || g.lowestPrice >= tier[i - 1].lowestPrice);
check(
  "lowest-price order within each tier",
  tierSorted(groups.filter((g) => g.storeCount > 1)) && tierSorted(groups.filter((g) => g.storeCount === 1)),
);

/* ------------------- catalog-id-first matching ------------------- */
/* Same catalog id merges even when one title omits the size/SPF;
 * stated conflicts (size, SPF, multipack) still split. */

const catalogMissingSize = buildGroups(dedupeOffers([
  offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Nykaa", price: 550, catalogId: "CATX" }),
  offer({ title: "CeraVe Moisturising Cream", store: "Amazon.in", price: 499, catalogId: "CATX" }),
  offer({ title: "CeraVe Moisturising Cream 50ml", store: "Purplle", price: 620, catalogId: "CATX" }),
]), "INR");
check("catalogId + one title missing size → one group", catalogMissingSize.length === 1 && catalogMissingSize[0].storeCount === 3, `got ${catalogMissingSize.length} groups`);

const catalogMissingSpf = buildGroups(dedupeOffers([
  offer({ title: "La Roche-Posay Anthelios SPF 50 50 ml", store: "Nykaa", price: 1050, catalogId: "CATS" }),
  offer({ title: "La Roche-Posay Anthelios 50 ml", store: "Amazon.in", price: 999, catalogId: "CATS" }),
]), "INR");
check("catalogId + one title missing SPF → one group", catalogMissingSpf.length === 1 && catalogMissingSpf[0].storeCount === 2, `got ${catalogMissingSpf.length} groups`);

const catalogSizeConflict = buildGroups(dedupeOffers([
  offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Nykaa", price: 550, catalogId: "CATY" }),
  offer({ title: "CeraVe Moisturising Cream 100 ml", store: "Amazon.in", price: 899, catalogId: "CATY" }),
]), "INR");
check("catalogId + conflicting stated sizes → two groups", catalogSizeConflict.length === 2, `got ${catalogSizeConflict.length} groups`);

const catalogSpfConflict = buildGroups(dedupeOffers([
  offer({ title: "La Roche-Posay Anthelios SPF 30 50 ml", store: "Nykaa", price: 950, catalogId: "CATZ" }),
  offer({ title: "La Roche-Posay Anthelios SPF 50 50 ml", store: "Amazon.in", price: 1050, catalogId: "CATZ" }),
]), "INR");
check("catalogId + conflicting SPF → two groups", catalogSpfConflict.length === 2, `got ${catalogSpfConflict.length} groups`);

const catalogMultipackConflict = buildGroups(dedupeOffers([
  offer({ title: "Pilgrim Vitamin C Serum 30 ml", store: "Nykaa", price: 450, catalogId: "CATM" }),
  offer({ title: "Pilgrim Vitamin C Serum 30 ml Pack of 2", store: "Amazon.in", price: 799, catalogId: "CATM" }),
]), "INR");
check("catalogId + multipack difference → two groups", catalogMultipackConflict.length === 2, `got ${catalogMultipackConflict.length} groups`);

/* ------------------------- chain clustering ------------------------- */
/* Candidate matches a NON-first cluster member → joins that group.
 * Sorted order is Amazon.in, Myntra, Nykaa. The Nykaa cream does NOT
 * match the first member (serum vs cream forms) but DOES match the
 * second (form unstated), so any-member matching keeps one group. */

const chain = buildGroups(dedupeOffers([
  offer({ title: "Minimalist Niacinamide Serum 30 ml", store: "Amazon.in", price: 500, catalogId: "CATCH" }),
  offer({ title: "Minimalist Niacinamide 30 ml", store: "Myntra", price: 520, catalogId: "CATCH" }),
  offer({ title: "Minimalist Niacinamide Cream 30 ml", store: "Nykaa", price: 540 }),
]), "INR");
check("chain: offer matching non-first member joins group", chain.length === 1 && chain[0].storeCount === 3, `got ${chain.length} groups`);

/* --------------- strictness kept without a catalog id --------------- */

const noCatalogSizeSplit = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C Serum 30 ml", store: "Nykaa", price: 500 }),
  offer({ title: "Dot & Key Vitamin C Serum 50 ml", store: "Amazon.in", price: 700 }),
]), "INR");
check("different sizes without catalogId still split", noCatalogSizeSplit.length === 2, `got ${noCatalogSizeSplit.length} groups`);

const noCatalogMissingSize = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C Serum 30 ml", store: "Nykaa", price: 500 }),
  offer({ title: "Dot & Key Vitamin C Serum", store: "Amazon.in", price: 450 }),
]), "INR");
check("missing size without catalogId merges when brand + title agree", noCatalogMissingSize.length === 1 && noCatalogMissingSize[0].storeCount === 2, `got ${noCatalogMissingSize.length} groups`);

/* ------------------------- query-brand fallback ------------------------ */
/* Brand-less titles ("Moisturizing Cream 50ml") can join the group of the
 * brand named in the query; variant strictness still applies. */

check("query brand from 'CeraVe Moisturizing Cream'", extractQueryBrand("CeraVe Moisturizing Cream") === "cerave");
check("query brand skips stopwords", extractQueryBrand("best cerave cream") === "cerave");
check("no query brand from 'Vitamin C serum'", extractQueryBrand("Vitamin C serum") === null);

const brandlessFixtures = [
  offer({ title: "Moisturizing Cream 50ml", store: "1mg", price: 480 }),
  offer({ title: "CeraVe Moisturizing Cream 50 ml", store: "Nykaa", price: 550 }),
  offer({ title: "CeraVe Moisturizing Cream 50ml", store: "Amazon.in", price: 499 }),
];
const brandlessMerged = buildGroups(dedupeOffers(brandlessFixtures), "INR", "cerave");
check("brand-less title merges via query brand", brandlessMerged.length === 1 && brandlessMerged[0].storeCount === 3, `got ${brandlessMerged.length} groups`);
const brandlessNoQuery = buildGroups(dedupeOffers(brandlessFixtures), "INR", null);
check("same pair splits without query brand", brandlessNoQuery.length === 2, `got ${brandlessNoQuery.length} groups`);
const brandlessWrongBrand = buildGroups(dedupeOffers(brandlessFixtures), "INR", "plum");
check("same pair splits with a different query brand", brandlessWrongBrand.length === 2, `got ${brandlessWrongBrand.length} groups`);

const brandlessFormSplit = buildGroups(dedupeOffers([
  offer({ title: "Moisturizing Lotion 50ml", store: "1mg", price: 480 }),
  offer({ title: "CeraVe Moisturizing Cream 50 ml", store: "Nykaa", price: 550 }),
]), "INR", "cerave");
check("brand-less lotion vs cream still splits", brandlessFormSplit.length === 2, `got ${brandlessFormSplit.length} groups`);

const brandlessSizeSplit = buildGroups(dedupeOffers([
  offer({ title: "Moisturizing Cream 50ml", store: "1mg", price: 480 }),
  offer({ title: "CeraVe Moisturizing Cream 177 ml", store: "Nykaa", price: 800 }),
]), "INR", "cerave");
check("brand-less 50ml vs 177ml still splits", brandlessSizeSplit.length === 2, `got ${brandlessSizeSplit.length} groups`);

const bothBrandless = buildGroups(dedupeOffers([
  offer({ title: "Vitamin C Face Serum 30 ml", store: "Mamaearth", price: 399 }),
  offer({ title: "Vitamin C Face Serum 30 ml", store: "Plum", price: 420 }),
]), "INR", "cerave");
check("both brand-less, no query-brand token → no merge", bothBrandless.length === 2, `got ${bothBrandless.length} groups`);

/* ----------------- distinctive-token + bundle guards ----------------- */
/* Live diagnosis (Dot & Key sunscreen search): one 13-store group had
 * merged five product lines + combos via title overlap, because shared
 * generic tokens (brand + "sunscreen" + "SPF 50") passed the overlap
 * bar while the line names were ignored. The guards below keep those
 * lines apart. They also apply to catalog-id matching: a shared id is
 * not proof of identity when the titles disagree on the product
 * itself (see catalogBundleGuard below). */

check("guard fires: Strawberry vs Vitamin C + E", hasDistinctiveTokens(
  "Dot & Key Strawberry Dew Tinted Sunscreen SPF 50+ PA++++",
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++",
) === true);
check("guard fires: Dragon Fruit vs Vitamin C + E", hasDistinctiveTokens(
  "Dot & Key Dragon Fruit Bounce Sunscreen SPF 50+ PA++++",
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++",
) === true);
check("guard quiet: one-sided retailer noise", hasDistinctiveTokens(
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++",
  "Dot & Key Vitamin C + E Super Bright Sunscreen, SPF 50+ PA++++ In-Vivo Tested At NykaaMan, Products Handpicked",
) === false);
check("guard quiet: same line, different claim noise", hasDistinctiveTokens(
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++ No White Cast",
  "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Water-Light, UVA/UVB & Blue Light Protection",
) === false);
check("bundle signal detected", isBundleTitle("Dot & Key Vitamin C Sunscreen Combo") && isBundleTitle("Skin Care Kit") && isBundleTitle("Glow Duo") && !isBundleTitle("Dot & Key Vitamin C Sunscreen"));
check("bundle mismatch: combo vs single", hasBundleMismatch("Sunscreen Combo", "Sunscreen") === true);
check("bundle match: two combos", hasBundleMismatch("Sunscreen Combo", "Face Wash Kit") === false);

const dotKeyVariants = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++", store: "Purplle", price: 224 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen, SPF 50+ PA++++ In-Vivo Tested", store: "Nykaa Man", price: 299 }),
  offer({ title: "Dot & Key Strawberry Dew Tinted Sunscreen SPF 50+ PA++++", store: "hkcosmetics.in", price: 384 }),
  offer({ title: "Dot & Key Dragon Fruit Bounce Sunscreen In-Vivo Tested SPF 50+ PA++++", store: "Amazon.in", price: 387 }),
  offer({ title: "Dot & Key Lime Rush Swim + Sports SPF 50+ PA++++ Sunscreen", store: "Glamzy", price: 446 }),
  offer({ title: "Dot & Key Watermelon Cooling Sunscreen SPF 50+", store: "blinkit.com", price: 433 }),
  offer({ title: "Dot & Key Watermelon Cooling Sunscreen (SPF 50+) + Watermelon Super Glow Face Wash Vitamin C & Cucumber Combo", store: "blinkit.com", price: 500 }),
]), "INR");
check("Dot & Key variants form 6 groups, not 1", dotKeyVariants.length === 6, `got ${dotKeyVariants.length}: ${dotKeyVariants.map((g) => g.title.slice(0, 45)).join(" / ")}`);
const vitCGroup = dotKeyVariants.find((g) => g.title.includes("Super Bright"));
check("Vitamin C + E pair merges across 2 stores despite retailer noise", vitCGroup?.storeCount === 2, `storeCount=${vitCGroup?.storeCount}`);
check("Strawberry is its own group", dotKeyVariants.some((g) => g.title.includes("Strawberry") && g.storeCount === 1));
check("Dragon Fruit is its own group", dotKeyVariants.some((g) => g.title.includes("Dragon Fruit") && g.storeCount === 1));
check("Lime Rush is its own group", dotKeyVariants.some((g) => g.title.includes("Lime Rush") && g.storeCount === 1));
check("Watermelon single is its own group", dotKeyVariants.some((g) => g.title === "Dot & Key Watermelon Cooling Sunscreen SPF 50+" && g.storeCount === 1));
check("Watermelon combo is its own group", dotKeyVariants.some((g) => g.title.includes("Combo") && g.storeCount === 1));

const strawberryVsVitC = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Strawberry Dew Tinted Sunscreen SPF 50+ PA++++", store: "Amazon.in", price: 420 }),
]), "INR");
check("Strawberry vs Vitamin C + E splits", strawberryVsVitC.length === 2, `got ${strawberryVsVitC.length} groups`);

const dragonVsVitC = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Dragon Fruit Bounce Sunscreen SPF 50+ PA++++", store: "Amazon.in", price: 420 }),
]), "INR");
check("Dragon Fruit vs Vitamin C + E splits", dragonVsVitC.length === 2, `got ${dragonVsVitC.length} groups`);

const limeVsWatermelon = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Lime Rush Swim + Sports SPF 50+ PA++++ Sunscreen", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Watermelon Cooling Sunscreen SPF 50+", store: "Amazon.in", price: 420 }),
]), "INR");
check("Lime Rush vs Watermelon splits", limeVsWatermelon.length === 2, `got ${limeVsWatermelon.length} groups`);

const noisePair = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++ No White Cast", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Water-Light, UVA/UVB & Blue Light Protection", store: "Amazon.in", price: 420 }),
]), "INR");
check("same product with different claim noise still merges", noisePair.length === 1 && noisePair[0].storeCount === 2, `got ${noisePair.length} groups`);

const comboVsSingle = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Combo", store: "Amazon.in", price: 700 }),
]), "INR");
check("combo vs single splits", comboVsSingle.length === 2, `got ${comboVsSingle.length} groups`);

const kitVsSingle = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Kit", store: "Amazon.in", price: 700 }),
]), "INR");
check("kit vs single splits", kitVsSingle.length === 2, `got ${kitVsSingle.length} groups`);

const valuePackVsSingle = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Value Pack", store: "Amazon.in", price: 700 }),
]), "INR");
check("value pack vs single splits", valuePackVsSingle.length === 2, `got ${valuePackVsSingle.length} groups`);

const duoVsSingle = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Duo", store: "Amazon.in", price: 700 }),
]), "INR");
check("duo vs single splits", duoVsSingle.length === 2, `got ${duoVsSingle.length} groups`);

/* Guards DO apply to catalog-id matching now: a shared catalog id is
 * not proof of identity when the titles name a bundle vs a single
 * (live Nov 2026: a Glycolic + Niacinamide bundle shared the serum's
 * catalog id and merged into its group). Claim noise still merges —
 * see catalogClaimNoise below. */
const catalogBundleGuard = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400, catalogId: "CATG" }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Combo", store: "Amazon.in", price: 700, catalogId: "CATG" }),
]), "INR");
check("catalogId + bundle word splits (guards apply to catalog matches)", catalogBundleGuard.length === 2, `got ${catalogBundleGuard.length} groups`);

const catalogClaimNoise = buildGroups(dedupeOffers([
  offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Nykaa", price: 550, catalogId: "CATD" }),
  offer({ title: "CeraVe Moisturising Cream 50 ml No White Cast Water-Light", store: "Amazon.in", price: 499, catalogId: "CATD" }),
]), "INR");
check("catalogId match merges despite extra claim words", catalogClaimNoise.length === 1, `got ${catalogClaimNoise.length} groups`);

/* Accepted limitation: a Hindi title splits from the English title of
 * the same product — its native-script words count as distinctive, and
 * sameness across scripts is unverifiable. Do not "fix" by stripping
 * non-Latin tokens: that would turn such titles into wildcard bridges
 * that re-merge different product lines. */
const hindiVsEnglish = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 PA+++", store: "Nykaa", price: 400 }),
  offer({ title: "Dot & Key विटामिन C + E सुपर ब्राइट सनस्क्रीन इन-वीवो टेस्ट SPF 50+ PA++++ नए एज", store: "amazon.in", price: 499 }),
]), "INR");
check("Hindi title splits from the English title (accepted)", hindiVsEnglish.length === 2, `got ${hindiVsEnglish.length} groups`);

/* ------------------------------ ordering ------------------------------ */

/* ------------- live regressions: Nov 2026 "The Ordinary" search ------------- */
/* A live search for "The Ordinary Niacinamide 10% + Zinc 1% Serum"
 * produced two defects at once: the same serum fragmented into three
 * 1-store cards (₹1,080 Syga / ₹1,100 Amazon / ₹2,200 Amazon), while
 * a "22 stores compared" card merged Minimalist, ThriveCo, Pilgrim
 * and The Element listings under a The Ordinary title with a bogus
 * ₹237–₹7,874 range and a fake "YOU SAVE ₹7,637 (97%)". Root cause:
 * extractBrand returned null for "The Ordinary ..." (first token
 * "the" is a stopword), so the query-brand fallback merged it with
 * any other brand whose title overlapped. */

check("brand extracted from 'The Ordinary ...'", extractBrand("The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml") === "ordinary");
check("brand extracted from 'The Body Shop ...'", extractBrand("The Body Shop Vitamin E Cream 50 ml") === "body");
check("brand still null for a generic lead word", extractBrand("Vitamin C Face Serum 30 ml") === null);

const ordinaryVsMinimalist = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 600 }),
  offer({ title: "Minimalist Niacinamide 10% Serum 30ml", store: "Amazon.in", price: 545 }),
  offer({ title: "ThriveCo Niacinamide Serum 30ml", store: "Nykaa", price: 379 }),
  offer({ title: "Pilgrim Niacinamide Serum 30ml", store: "Amazon.in", price: 487 }),
]), "INR", extractQueryBrand("The Ordinary Niacinamide 10% + Zinc 1% Serum"));
check("Ordinary vs Minimalist/ThriveCo/Pilgrim split into 4 groups", ordinaryVsMinimalist.length === 4, `got ${ordinaryVsMinimalist.length}: ${ordinaryVsMinimalist.map((g) => g.title.slice(0, 40)).join(" / ")}`);

const ordinaryFragmented = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum", store: "Syga", price: 1080 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 1100 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30 ml", store: "Amazon.in", price: 2200 }),
]), "INR", extractQueryBrand("The Ordinary Niacinamide 10% + Zinc 1% Serum"));
check("same Ordinary serum merges across Syga + Amazon despite missing size", ordinaryFragmented.length === 1 && ordinaryFragmented[0].storeCount === 2 && ordinaryFragmented[0].offers.length === 3, `got ${ordinaryFragmented.length} groups`);

const catalogDifferentBrands = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 600, catalogId: "CATB" }),
  offer({ title: "Minimalist Niacinamide 10% Serum 30ml", store: "Amazon.in", price: 545, catalogId: "CATB" }),
]), "INR");
check("shared catalogId never merges different brands", catalogDifferentBrands.length === 2, `got ${catalogDifferentBrands.length} groups`);

const singleStoreSpread = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 1100 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 2200 }),
]), "INR");
check("single-store group reports no saving", singleStoreSpread.length === 1 && singleStoreSpread[0].savingsPercent === 0, `got savingsPercent=${singleStoreSpread[0]?.savingsPercent}`);
const multiStoreSpread = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 1100 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 600 }),
]), "INR");
check("multi-store group still reports its saving", multiStoreSpread.length === 1 && multiStoreSpread[0].savingsPercent > 0, `got savingsPercent=${multiStoreSpread[0]?.savingsPercent}`);

/* ------------------------------ ordering ------------------------------ */

const ordering = buildGroups(dedupeOffers([
  offer({ title: "Cheap Solo Serum 30 ml", store: "Nykaa", price: 100 }),
  offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Nykaa", price: 550, catalogId: "CATO" }),
  offer({ title: "CeraVe Moisturising Cream 50ml", store: "Amazon.in", price: 499, catalogId: "CATO" }),
  offer({ title: "CeraVe Moisturising Cream - 50 ml", store: "Purplle", price: 620, catalogId: "CATO" }),
]), "INR");
check("3-store group sorts before cheaper 1-store group", ordering.length === 2 && ordering[0].storeCount === 3 && ordering[1].storeCount === 1, `got ${ordering.map((g) => `${g.title}:${g.storeCount}`).join(" / ")}`);

/* ------------------------------ dedupe -------------------------------- */

const dupes = dedupeOffers([
  offer({ title: "Same Product 50 ml", store: "Nykaa", price: 100, provider: "serpapi" }),
  offer({ title: "Same Product 50 ml", store: "Nykaa", price: 100, provider: "serper", catalogId: "C9", imageUrl: "https://x/y.jpg" }),
  offer({ title: "Same Product 50 ml", store: "Nykaa", price: 120, provider: "serper" }),
]);
check("exact duplicates collapse, richer copy kept", dupes.length === 2 && dupes.some((d) => d.catalogId === "C9"));

/* --------------------------- unpriced offers --------------------------- */

const withUnpriced = buildGroups(
  [...fixtures, offer({ title: "CeraVe Moisturising Cream 50 ml", store: "Ghost", price: 0, catalogId: "CAT1" })].map(
    (o) => (o.store === "Ghost" ? { ...o, price: null } : o),
  ),
  "INR",
);
check("unpriced offers excluded", withUnpriced.every((g) => g.offers.every((o) => o.price > 0)));

/* ------------- live regression: Nov 2026 "Skin Support Set" card ------------- */
/* A live search for "The Ordinary Niacinamide 10% + Zinc 1% Serum"
 * (captured 2026-11-22 via /api/search, 69 offers) still produced a
 * 19-store mixed-brand card AFTER the first strict-identity fix, even
 * though the fixture tests passed. Root cause, found by replaying the
 * real titles through the real code: live titles are ingredient- and
 * percentage-led, which the fixtures never were —
 *   - extractBrand("10% Niacinamide ...") returned "10" and
 *     extractBrand("Niacinamide 10% + Zinc 1%") returned "niacinamide",
 *     and sameBrand's head check matched those pseudo-brands against
 *     every niacinamide title's first three words. The brand-less
 *     sweetcare offer bridged the Ordinary cluster to ThriveCo,
 *     The Element and Minimalist.
 *   - "Skin Support Set" did not match the old bundle regex (it
 *     required "set of"), so the set absorbed single serums.
 * The fixtures below use the exact live titles. */

check("brand null for a percentage-led title", extractBrand("10% Niacinamide Serum with 1% Zinc PCA") === null);
check("brand null for an ingredient-led title", extractBrand("Niacinamide 10% + Zinc 1%") === null);
check("brand null for a size-led title", extractBrand("30ml Serum") === null);
check("brand null for a percentage-led active", extractBrand("2% Salicylic Acid Serum") === null);
check("brand null for a generic-led title", extractBrand("Brightening 10% Niacinamide Face Serum") === null);
check("bare 'set' is a bundle", isBundleTitle("The Ordinary Skin Support Set Niacinamide 10% + Zinc 1%"));
check("'With Pouch' is a bundle", isBundleTitle("The Ordinary Soothing & Barrier Support Serum With Pouch"));
check("bare 'Pack' is a bundle", isBundleTitle("THE ORDINARY Glycolic Acid 7% Exfoliating Toner-100ml +Niacinamide 10% +Zinc 1% Serum-30ml'('Pack\")\"'by Myntra"));
check("'Pack of 1' is NOT a bundle", !isBundleTitle("Serum Pack of 1"));
check("'( pack 2)' is a 2-pack", extractMultipack("The Ordinary Hyaluronic Serum acid 2% + B5 30ml And Niacinamide 10% +zinc 1% Serum ( pack 2) 30ml") === 2);
check("'60ml 2 pc' is a 2-pack", extractMultipack("The Ordinary N10+Z1 Face Serum (1 Niacinamide 10% + 1% Zinc 2) 60ml 2 pc") === 2);

const liveOrdinary: RawOffer[] = [
  // The 19-store mixed card, as captured live (providers kept for realism).
  offer({ title: "10% Niacinamide Serum with 1% Zinc PCA", store: "ThriveCo", price: 379, provider: "serper" }),
  offer({ title: "10% Niacinamide + 1% Zinc Brightening Serum | The Element Single Pack", store: "The Element", price: 519 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%", store: "Amazon.in", price: 600, provider: "serper" }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%", store: "luxe.ajio.com", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%", store: "Nykaa", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%, Brightening & Smoothing Serum for Blemish-Prone Skin", store: "The LuxeCare", price: 600 }),
  offer({ title: "The Ordinary Soothing & Barrier Support Serum With Pouch", store: "Myntra", price: 720 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml/1oz", store: "Strawberrynet.com", price: 1172 }),
  offer({ title: "THE ORDINARY Glycolic Acid 7% Exfoliating Toner-100ml +Niacinamide 10% +Zinc 1% Serum-30ml'('Pack\")\"'by Myntra", store: "Myntra", price: 1200 }),
  offer({ title: "The Ordinary Hyaluronic Serum acid 2% + B5 30ml And Niacinamide 10% +zinc 1% Serum ( pack 2) 30ml", store: "Nutraog", price: 1399 }),
  offer({ title: "The Ordinary Skin Support Set Niacinamide 10% + Zinc 1%", store: "addmecart", price: 1400 }),
  offer({ title: "The Ordinary Skin Support Set Niacinamide 10% + Zinc 1%", store: "Fliptwirls", price: 1400, provider: "searlo" }),
  offer({ title: "The Ordinary The Skin Support Set", store: "Escentual", price: 1700 }),
  offer({ title: "The Ordinary Soothing & Barrier Support Serum", store: "Nykaa", price: 1850 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% - Blemish Control & Pore Minimizing Serum 30 ml", store: "Instachiq", price: 1886.29, provider: "serper" }),
  offer({ title: "Niacinamide 10% + Zinc 1%", store: "sweetcare.com", price: 1924.14 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Smoothing Serum For Blemish-Prone Skin 4.1 Fl Oz", store: "KIWLA", price: 2024 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml)", store: "KIWLA", price: 2089 }),
  offer({ title: "The Ordinary The Skin Support Set", store: "Care to Beauty", price: 2282.26, provider: "serper" }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum", store: "GoSupps Beauty", price: 2778.56 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum for Face 1 FL OZ with Alive Intensity Hyaluronic Acid Face Serum", store: "GoSupps Beauty", price: 4631.55, provider: "searlo" }),
  offer({ title: "The Ordinary N10+Z1 Face Serum (1 Niacinamide 10% + 1% Zinc 2) 60ml 2 pc", store: "Japan Shop Fuji", price: 5095.72, provider: "searlo" }),
  offer({ title: "THE ORDINARY Niacinamide Zinc Educes Skin Irritation Blemish Formula", store: "GoSupps Beauty", price: 6947.78, provider: "searlo" }),
  offer({ title: "The Ordinary 3 Bottles Face Serum Set! Hyaluronic Acid Serum, Rosehip Oil And Niacinamide Serum! Hyaluronic Ac", store: "GoSupps.com", price: 7874.28, provider: "serper" }),
  // The 9-store mixed card (g2), as captured live.
  offer({ title: "Minimalist 10% Niacinamide Face Serum", store: "Purplle.com - Purplle- MP", price: 237, provider: "serper" }),
  offer({ title: "10% Niacinamide + 1% Zinc Face Serum for Acne Marks, Blemishes & Oil Balancing | Skin Clarifying Anti Acne Serum for Oily & Acne Prone Skin | 30 ml", store: "amazon.in", price: 399, provider: "serper" }),
  offer({ title: "10% Niacinamide Face Serum with 0.5% Zinc, 30ml – Oil Control Serum for Clear, Smooth & Balanced Looking Skin", store: "MNT", price: 460 }),
  offer({ title: "Minimalist Niacinamide 10% + Zinc Face Serum", store: "Nykaa Now", price: 569, provider: "serper" }),
  offer({ title: "Minimalist 10% Niacinamide Face Serum", store: "Shoppers Stop", price: 599 }),
  offer({ title: "Glutone 10% Niacinamide + Zinc Serum for Oily", store: "Dermalogy Care", price: 679 }),
  offer({ title: "10% Niacinamide Serum with 1% Zinc PCA", store: "Maccaron", price: 699 }),
  offer({ title: "Buy 10% Niacinamide Face Serum", store: "SkinInspired", price: 799, provider: "serper" }),
  offer({ title: "Buy 10% Niacinamide Face Serum Best For Acne & Oily Skin", store: "SkinInspired", price: 799, provider: "serper" }),
  offer({ title: "10% niacinamide Oil control serum with Zinc 1%", store: "New69BC", price: 1319, provider: "serper" }),
  // The three single-bottle cards.
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%, Brightening & Smoothing Serum for Blemish-Prone Skin, 30ml 30 ml (Pack of 2)", store: "Syga India", price: 1080 }),
  offer({ title: "The Ordinary Niacinamide 10% + जिंक 1%, ब्राइटनिंग और स्मूथिंग सीरम ब्लेमिश-प्रोन स्किन के लिए, 60ml", store: "amazon.in", price: 1100 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1%, Brightening & Smoothing Serum for Blemish-Prone Skin, 60ml (Pack of 2)", store: "amazon.in", price: 2200 }),
];

const liveGroups = buildGroups(
  dedupeOffers(liveOrdinary),
  "INR",
  extractQueryBrand("The Ordinary Niacinamide 10% + Zinc 1% Serum"),
);
const groupOf = (store: string, price: number) =>
  liveGroups.find((g) => g.offers.some((o) => o.store === store && o.price === price));
const ordinaryGroup = groupOf("Amazon.in", 600);
check(
  "live: single-bottle serum merges across 9 stores (was fragmented + mixed)",
  ordinaryGroup !== undefined && ordinaryGroup.storeCount === 9 && ordinaryGroup.lowestPrice === 600,
  `storeCount=${ordinaryGroup?.storeCount}`,
);
check(
  "live: no other brand shares the Ordinary serum group",
  ordinaryGroup !== undefined &&
    ordinaryGroup.offers.every((o) => o.title.toLowerCase().includes("ordinary") || o.title === "Niacinamide 10% + Zinc 1%"),
  ordinaryGroup?.offers.map((o) => `${o.store}:${o.title.slice(0, 30)}`).join(" / ") ?? "",
);
const setGroup = groupOf("addmecart", 1400);
check(
  "live: Skin Support Set is its own 4-store group (was the 19-store mixed card)",
  setGroup !== undefined && setGroup.storeCount === 4 && setGroup.offers.every((o) => o.title.includes("Skin Support Set")),
  `storeCount=${setGroup?.storeCount}`,
);
check("live: ThriveCo stands alone", groupOf("ThriveCo", 379)?.offers.length === 1);
check("live: The Element stands alone", groupOf("The Element", 519)?.offers.length === 1);
check("live: Glutone stands alone", groupOf("Dermalogy Care", 679)?.offers.length === 1);
const minimalistGroup = groupOf("Purplle.com - Purplle- MP", 237);
check(
  "live: Minimalist trio stays one 3-store group",
  minimalistGroup !== undefined && minimalistGroup.storeCount === 3,
  `storeCount=${minimalistGroup?.storeCount}`,
);
check(
  "live: the two 60ml Amazon cards stay separate — 1-pack vs 2-pack, not the same variant (₹2,200 is exactly 2× ₹1,100)",
  groupOf("amazon.in", 1100) !== groupOf("amazon.in", 2200),
);
check(
  "live: 30ml 2-pack Syga stays separate from the 60ml singles (size + pack differ)",
  groupOf("Syga India", 1080)?.offers.length === 1,
);

/* ------------- live regression: Nov 2026 Cetaphil size/line mixing ------------- */
/* A phone screenshot (2026-11-22) showed one Cetaphil cleanser group
 * holding FirstCry ₹161, Amazon ₹179 and Nykaa ₹197 (small-pack
 * Hydrating Foaming Cream Cleanser) together with Amazon ₹1,789 (the
 * 1L Gentle Skin Cleanser, ₹1,786 on Amazon itself). Root cause,
 * found by replaying the real titles through the real code: the
 * listings share a Google catalog id, and the catalog-id path merged
 * them — a size stated on one side only never conflicts, and the
 * distinctive-token / bundle guards never touched catalog-id
 * matching. Worse, "Gentle Skin Cleanser" reduced to ZERO significant
 * tokens ("gentle" and "skin" were claim words, "cleanser" a form),
 * so the token guard could never fire against "Foaming" even on the
 * title path. The fixtures below pin the fix: guards apply on the
 * catalog path too, and "gentle" is a line word. */

check("guard fires: Foaming Cream Cleanser vs Gentle Skin Cleanser", hasDistinctiveTokens(
  "Cetaphil Hydrating Foaming Cream Cleanser",
  "Cetaphil Gentle Skin Cleanser 1L",
) === true);
check("guard quiet: same line, size differs only", hasDistinctiveTokens(
  "Cetaphil Hydrating Foaming Cream Cleanser",
  "Cetaphil Hydrating Foaming Cream Cleanser 125ml",
) === false);

const cetaphilCatalog = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "FirstCry India", price: 161, catalogId: "CATCET" }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser 125ml", store: "Amazon.in", price: 179, catalogId: "CATCET" }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "Nykaa", price: 197, catalogId: "CATCET" }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 1L", store: "Amazon.in", price: 1789, catalogId: "CATCET" }),
]), "INR");
check("Cetaphil: small-pack cleansers merge, 1L stays separate despite shared catalogId", cetaphilCatalog.length === 2, `got ${cetaphilCatalog.length}`);
const cetaphilSmall = cetaphilCatalog.find((g) => g.lowestPrice === 161);
check("Cetaphil: small-pack group is 3 stores, ₹161–₹197", cetaphilSmall !== undefined && cetaphilSmall.storeCount === 3 && cetaphilSmall.highestPrice === 197, `stores=${cetaphilSmall?.storeCount} high=${cetaphilSmall?.highestPrice}`);
check("Cetaphil: 1L is its own group", cetaphilCatalog.some((g) => g.offers.length === 1 && g.lowestPrice === 1789));

const cetaphilLines = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "FirstCry India", price: 161 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 1L", store: "Amazon.in", price: 1789 }),
]), "INR");
check("Foaming Cream Cleanser vs Gentle Skin Cleanser splits (no catalogId)", cetaphilLines.length === 2, `got ${cetaphilLines.length} groups`);

/* ------------- live regression: Nov 2026 Ordinary 60ml bridge + bundle ------------- */
/* A browser check (2026-11-22) on "The Ordinary Niacinamide 10% +
 * Zinc 1% Serum" found 60ml listings (₹1,886.29, ₹3,456) and a
 * Glycolic Acid toner + Niacinamide bundle (₹1,711.15, desertcart)
 * inside the 30ml serum group. Root cause, found by replaying the
 * real titles through the real code: a size-less listing bridged the
 * 30ml and 60ml variants (a candidate only had to match ANY cluster
 * member, so the 60ml joined through the size-less one), and the
 * bundle shared the serum's catalog id, where the guards never
 * applied. The fix: a candidate joins only when it conflicts with NO
 * member of the cluster. (The "joins the largest qualifying cluster"
 * half of this fix was superseded in the Cetaphil catch-all fix:
 * largest snowballed plain titles into the biggest cluster, so the
 * join now takes the FIRST qualifying cluster — the no-size listing
 * here seeds its cluster, it does not join by size.) */

const ordinarySizeBridge = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 620 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Purplle", price: 640 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum", store: "Amazon.in", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 60ml", store: "Amazon.in", price: 1886 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 60ml", store: "Nykaa", price: 3456 }),
]), "INR", extractQueryBrand("The Ordinary Niacinamide 10% + Zinc 1% Serum"));
check("Ordinary: 30ml + no-size + 60ml form exactly 2 groups", ordinarySizeBridge.length === 2, `got ${ordinarySizeBridge.length}`);
const serum30 = ordinarySizeBridge.find((g) => g.offers.some((o) => o.price === 600 && o.store === "Nykaa"));
check("Ordinary: 30ml group holds the no-size listing (majority variant)", serum30 !== undefined && serum30.offers.length === 4 && serum30.storeCount === 3, `offers=${serum30?.offers.length} stores=${serum30?.storeCount}`);
const serum60 = ordinarySizeBridge.find((g) => g.offers.some((o) => o.price === 1886));
check("Ordinary: 60ml group is its own 2-store group", serum60 !== undefined && serum60.offers.length === 2 && serum60.storeCount === 2, `offers=${serum60?.offers.length} stores=${serum60?.storeCount}`);
check("Ordinary: no group mixes stated 30ml and 60ml", ordinarySizeBridge.every((g) => {
  const sizes = new Set(g.offers.map((o) => extractSize(o.title)?.value ?? null));
  return !(sizes.has(30) && sizes.has(60));
}));

const ordinaryCatalogBundle = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 600, catalogId: "CATOB" }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml + Glycolic Acid 7% Toning Solution 240ml Combo", store: "desertcart.com.sa", price: 1711, catalogId: "CATOB" }),
]), "INR");
check("catalogId + bundle word splits (was the live desertcart merge)", ordinaryCatalogBundle.length === 2, `got ${ordinaryCatalogBundle.length} groups`);

/* ------------- live regression: Nov 2026 "22 stores, 34 prices" count ------------- */
/* The Ordinary group card said "22 stores compared" / "View all 22
 * prices" while the expanded group listed 34 offers. storeCount
 * counts distinct stores; the expanded list counts offers (StoreRows
 * maps group.offers). The card's "View all N prices" must use
 * offers.length — this pins the group shape that distinction relies
 * on (the label fix itself is in Results.tsx). */
const countShape = buildGroups(dedupeOffers([
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Amazon.in", price: 650 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml", store: "Nykaa", price: 620 }),
]), "INR");
check("one store can hold two prices: storeCount 2, offers 3", countShape.length === 1 && countShape[0].storeCount === 2 && countShape[0].offers.length === 3, `stores=${countShape[0]?.storeCount} offers=${countShape[0]?.offers.length}`);
/* ------------- live regression: Nov 2026 Cetaphil no-size catch-all ------------- */
/* A live search (2026-11-22) for "Cetaphil Gentle Skin Cleanser" returned
 * a 24-offer catch-all (20 stores, ₹99–₹2,321.42) mixing Exfoliating SA,
 * Foaming, Bright Healthy Radiance, Gentle Acne and two "&" two-product
 * titles, plus a size-less FirstCry ₹161 "Hydrating Foaming Cream
 * Cleanser" inside it. Root cause, found by replaying the real titles:
 *  (a) plain titles keep only {gentle}, so they bridge every line — the
 *      token guard only fires when EACH side keeps a token the other
 *      lacks, and a candidate only had to match ANY cluster member;
 *  (b) the two "&" titles escaped the bundle guard (no combo/kit/duo
 *      word), and the 125ml one anchored the catch-all: its stated
 *      size made the veto repel every other size-stated listing;
 *  (c) "acne" was a dropped claim word, so the Acne line had no
 *      significant token at all;
 *  (d) "Sa" and "Salicylic Acid" were different tokens, so one product
 *      would split under the new seed check.
 * The fix: "&"-bundle detection; "acne" rescued as a line word;
 * "sa" -> "salicylic"; a candidate must agree with the cluster SEED
 * (seedLineAgrees) and a sized listing joining a size-less-seeded
 * cluster must name the seed's line in full (sizeLineOk); and the
 * join takes the FIRST qualifying cluster, not the largest — largest
 * snowballed the plain titles into whichever cluster was biggest
 * (Foaming, 17 offers in the replay) even with the seed checks. */

check("Acne is a line word: Gentle Acne splits from Exfoliating Sa", hasDistinctiveTokens("Cetaphil Gentle Acne Cleanser", "Cetaphil Gentle Exfoliating Sa Cleanser"));
check("Sa is salicylic acid: Exfoliating Sa does not split from Salicylic Acid", !hasDistinctiveTokens("Cetaphil Gentle Exfoliating Sa Cleanser", "Cetaphil Gentle Exfoliating Salicylic Acid Cleanser"));
check("Foaming splits from Exfoliating Sa", hasDistinctiveTokens("Cetaphil Gentle Foaming Cleanser", "Cetaphil Gentle Exfoliating Sa Cleanser"));
check("Foaming splits from Bright Healthy Radiance", hasDistinctiveTokens("Cetaphil Gentle Foaming Cleanser", "Cetaphil Bright Healthy Radiance Gentle Renewing Cleanser"));

check("ampersand bundle detected: two sizes + two forms", isBundleTitle("Cetaphil Gentle Skin Cleanser 125 Ml & Moisturising Cream 80 Gm") && isBundleTitle("Cetaphil Gentle Skin Cleanser Pump & Moisturizing Lotion Pump"));
check("ampersand bundle detected: two forms, no size", isBundleTitle("Shampoo & Conditioner") && isBundleTitle("Cleanser & Toner") && isBundleTitle("Niacinamide Serum 30ml & Hyaluronic Serum 30ml"));
check("ampersand is NOT a bundle: body parts", !isBundleTitle("Cetaphil Gentle Face & Body Wash 59ml") && !isBundleTitle("Cetaphil Gentle Skin Cleanser 20 fl oz | Hydrating Face Wash & Body Wash | Ideal For Sensitive, Dry Skin | Non-irritating | Wont Clog Pores |"));
check("ampersand is NOT a bundle: one product, two functions", !isBundleTitle("2-in-1 Shampoo & Conditioner") && !isBundleTitle("Blemish Control & Pore Minimizing Serum"));
check("plus is NOT a bundle: ingredients", !isBundleTitle("The Ordinary Niacinamide 10% + Zinc 1% Serum 30ml"));

const saPair = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Gentle Exfoliating Sa Cleanser", store: "Nykaa", price: 99 }),
  offer({ title: "Cetaphil Gentle Exfoliating Salicylic Acid Cleanser", store: "DMart Ready", price: 1000 }),
]), "INR", extractQueryBrand("Cetaphil Gentle Exfoliating Sa Cleanser"));
check("Sa and Salicylic Acid are one product", saPair.length === 1, `got ${saPair.length} groups`);
const acneSplit = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Gentle Acne Cleanser", store: "Nutraog", price: 1499 }),
  offer({ title: "Cetaphil Gentle Exfoliating Sa Cleanser", store: "1mg", price: 99 }),
]), "INR", extractQueryBrand("Cetaphil Gentle Acne Cleanser"));
check("Gentle Acne splits from Exfoliating Sa", acneSplit.length === 2, `got ${acneSplit.length} groups`);

/* The 24 offers of the live catch-all, verbatim from the 2026-11-22 search. */
const catchall24 = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Gentle Exfoliating Sa Cleanser Sensitive Skin", store: "1mg", price: 99 }),
  offer({ title: "Cetaphil Gentle Exfoliating SA Cleanser", store: "Purplle.com", price: 99 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Tinygrasp", price: 199 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Purplle.com - Beauty Online", price: 399 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Purplle.com - Purplle Beauty Shop", price: 399 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Purplle.com - Purplle Shopping", price: 399 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Nykaa", price: 663 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser For Dry To Normal Sensitive Skin", store: "1mg", price: 735 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Vyloo", price: 775.03 }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "JioMart Grocery", price: 818 }),
  offer({ title: "Cetaphil Bright Healthy Radiance Gentle Renewing Cleanser", store: "Myntra - MNow", price: 841 }),
  offer({ title: "Cetaphil Daily Exfoliating Cleanser", store: "PharmEasy", price: 857.22 }),
  offer({ title: "Cetaphil Gentle Foaming Cleanser", store: "Zepto", price: 881 }),
  offer({ title: "Old Version Cetaphil Gentle Foaming Cleanser", store: "Indicrest.com", price: 899 }),
  offer({ title: "Cetaphil Gentle Foaming Cleanser Normal to Dry Skin", store: "Apollo247", price: 945 }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "Tira", price: 977 }),
  offer({ title: "Cetaphil Gentle Exfoliating Salicylic Acid Cleanser", store: "DMart Ready", price: 1000 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 125 Ml & Moisturising Cream 80 Gm", store: "amazon.in", price: 1018 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "PharmEasy", price: 1026.21 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "PharmEasy", price: 1272.33 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser Pump & Moisturizing Lotion Pump", store: "amazon.in", price: 1299 }),
  offer({ title: "Cetaphil Gentle Acne Cleanser", store: "Nutraog", price: 1499 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Nykaa Now", price: 1690 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser Sensitive Skin", store: "drnutrition.com", price: 2321.42 }),
]), "INR", extractQueryBrand("Cetaphil Gentle Skin Cleanser"));
check("catch-all splits into 5 groups, not 1", catchall24.length === 5, `got ${catchall24.length} groups`);
const catchallExfoliating = catchall24.find((g) => g.offers.some((o) => o.price === 99 && o.store === "1mg"));
check("catch-all Exfoliating family: 15 offers, 12 stores", catchallExfoliating !== undefined && catchallExfoliating.offers.length === 15 && catchallExfoliating.storeCount === 12, `offers=${catchallExfoliating?.offers.length} stores=${catchallExfoliating?.storeCount}`);
const catchallFoaming = catchall24.find((g) => g.offers.some((o) => o.price === 945 && o.store === "Apollo247"));
check("catch-all Foaming family: 5 offers, 5 stores, ₹818–₹977", catchallFoaming !== undefined && catchallFoaming.offers.length === 5 && catchallFoaming.storeCount === 5 && catchallFoaming.lowestPrice === 818 && catchallFoaming.highestPrice === 977, `offers=${catchallFoaming?.offers.length} stores=${catchallFoaming?.storeCount} range=${catchallFoaming?.lowestPrice}–${catchallFoaming?.highestPrice}`);
const catchallBundles = catchall24.find((g) => g.offers.some((o) => o.price === 1018));
check("catch-all '&' bundles: 2 offers, 1 store", catchallBundles !== undefined && catchallBundles.offers.length === 2 && catchallBundles.storeCount === 1, `offers=${catchallBundles?.offers.length} stores=${catchallBundles?.storeCount}`);
check("catch-all Bright and Acne are alone", catchall24.some((g) => g.offers.length === 1 && g.offers[0].price === 841) && catchall24.some((g) => g.offers.length === 1 && g.offers[0].price === 1499));

/* Compact cross-line fixture: the ₹161 FirstCry title (from the browser
 * check — it was inside the live catch-all), the 1L group, the 591ml
 * pair, the 118ml and 59ml singles. All titles verbatim from the live
 * search except the FirstCry ₹161 offer, which is the browser-check
 * title. The Apollo247 Foaming ₹945 offer must come before the
 * Hydrating Foaming offers so the Foaming cluster seeds with the
 * superset tokens {gentle, foaming}: if Hydrating Foaming ({foaming})
 * seeds first, Gentle Foaming titles are blocked by seedLineAgrees
 * and split off. */
const cetaphilCompact = buildGroups(dedupeOffers([
  offer({ title: "Cetaphil Gentle Exfoliating Sa Cleanser Sensitive Skin", store: "1mg", price: 99 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser", store: "Nykaa", price: 663 }),
  offer({ title: "Cetaphil Daily Exfoliating Cleanser", store: "PharmEasy", price: 857.22 }),
  offer({ title: "Cetaphil Gentle Exfoliating Salicylic Acid Cleanser", store: "DMart Ready", price: 1000 }),
  offer({ title: "Cetaphil Gentle Foaming Cleanser Normal to Dry Skin", store: "Apollo247", price: 945 }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "FirstCry India", price: 161 }),
  offer({ title: "Cetaphil Hydrating Foaming Cream Cleanser", store: "JioMart Grocery", price: 818 }),
  offer({ title: "Cetaphil Gentle Foaming Cleanser", store: "Zepto", price: 881 }),
  offer({ title: "Cetaphil Bright Healthy Radiance Gentle Renewing Cleanser", store: "Myntra - MNow", price: 841 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 125 Ml & Moisturising Cream 80 Gm", store: "amazon.in", price: 1018 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser Pump & Moisturizing Lotion Pump", store: "amazon.in", price: 1299 }),
  offer({ title: "Cetaphil Gentle Acne Cleanser", store: "Nutraog", price: 1499 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 1 L", store: "Apollo247", price: 1519.20 }),
  offer({ title: "Cetaphil White Gentle Skin Cleanser for Dry Normal Sensitive Skin 1000 ml", store: "Indya", price: 4415 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser | 591ml | Dry to Normal, Sensitive Skin", store: "Baby's World", price: 2025 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 20 fl oz | Hydrating Face Wash & Body Wash | Ideal For Sensitive, Dry Skin | Non-irritating | Wont Clog Pores |", store: "ubuy.co.in", price: 2842 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 118 ml", store: "Apollo247", price: 371.80 }),
  offer({ title: "Cetaphil Gentle Skin Cleanser 59ml Hydrating Face & Body Wash for Sensitive Dry Skin Soap-Free", store: "1mg", price: 219 }),
]), "INR", extractQueryBrand("Cetaphil Gentle Skin Cleanser"));
check("compact Cetaphil fixture: 9 groups", cetaphilCompact.length === 9, `got ${cetaphilCompact.length} groups`);
const compactFoaming = cetaphilCompact.find((g) => g.offers.some((o) => o.price === 161));
check("₹161 FirstCry title lands with Foaming, not the catch-all", compactFoaming !== undefined && compactFoaming.offers.length === 4 && compactFoaming.lowestPrice === 161 && compactFoaming.highestPrice === 945, `offers=${compactFoaming?.offers.length} range=${compactFoaming?.lowestPrice}–${compactFoaming?.highestPrice}`);
const compact1L = cetaphilCompact.find((g) => g.offers.some((o) => o.price === 1519.20));
check("1L group is clean: 2 offers, no Bright/Acne", compact1L !== undefined && compact1L.offers.length === 2 && compact1L.lowestPrice === 1519.20 && compact1L.highestPrice === 4415, `offers=${compact1L?.offers.length} range=${compact1L?.lowestPrice}–${compact1L?.highestPrice}`);
const compact591 = cetaphilCompact.find((g) => g.offers.some((o) => o.price === 2025));
check("591ml pair stays together (incl. the Face Wash & Body Wash title)", compact591 !== undefined && compact591.offers.length === 2 && compact591.lowestPrice === 2025 && compact591.highestPrice === 2842, `offers=${compact591?.offers.length}`);
check("compact: 118ml and 59ml are alone", cetaphilCompact.some((g) => g.offers.length === 1 && g.offers[0].price === 371.80) && cetaphilCompact.some((g) => g.offers.length === 1 && g.offers[0].price === 219));
check("compact: Bright and Acne are alone, bundles are together", cetaphilCompact.some((g) => g.offers.length === 1 && g.offers[0].price === 841) && cetaphilCompact.some((g) => g.offers.length === 1 && g.offers[0].price === 1499) && cetaphilCompact.some((g) => g.offers.length === 2 && g.offers.some((o) => o.price === 1018) && g.offers.some((o) => o.price === 1299)));

/* ---------------- saving calculation outlier exclusion ---------------- */
/* The Ordinary 30ml group had prices: 600, 600, 600, 1172, 1886.29, 1924.14,
 * 4631.55, 6947.78. Comparing 600 vs 6947.78 produced a bogus 91% saving claim
 * driven by an extreme import outlier. Prices above 3x the median (median =
 * 1529.145, 3x = 4587.435) must be excluded from the saving calculation:
 * 4631.55 and 6947.78 drop out, leaving 1924.14 as the comparison max.
 * Saving is 1924.14 - 600 = 1324.14 (69%), NOT 91%.
 * The full price range (600 to 6947.78) stays visible in the group. */

const ordinaryOutlierOffers = [
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store A", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store B", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store C", price: 600 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store D", price: 1172 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store E", price: 1886.29 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store F", price: 1924.14 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store G", price: 4631.55 }),
  offer({ title: "The Ordinary Niacinamide 10% + Zinc 1% 30ml", store: "Store H", price: 6947.78 }),
];

const ordinarySavings = computeGroupSavings(ordinaryOutlierOffers, "INR");
check(
  "saving outlier: 3x median excludes 4631.55 and 6947.78 (saving is 69%, not 91%)",
  ordinarySavings !== null &&
    ordinarySavings.savingsPercent === 69 &&
    ordinarySavings.comparisonPrice === 1924.14 &&
    ordinarySavings.savings === 1324.14,
  `savingsPercent=${ordinarySavings?.savingsPercent} comparisonPrice=${ordinarySavings?.comparisonPrice}`,
);

const ordinaryOutlierGroups = buildGroups(dedupeOffers(ordinaryOutlierOffers), "INR", "ordinary");
check(
  "saving outlier: buildGroups reflects 69% saving while keeping full 6947.78 highestPrice",
  ordinaryOutlierGroups.length === 1 &&
    ordinaryOutlierGroups[0].savingsPercent === 69 &&
    ordinaryOutlierGroups[0].highestPrice === 6947.78 &&
    ordinaryOutlierGroups[0].lowestPrice === 600,
  `groups=${ordinaryOutlierGroups.length} savingsPercent=${ordinaryOutlierGroups[0]?.savingsPercent} highest=${ordinaryOutlierGroups[0]?.highestPrice}`,
);

// Under 2 prices remaining after 3x median exclusion hides the saving
const outlierFewRemain = computeGroupSavings([
  { price: 100, store: "A" },
  { price: 100, store: "B" },
  { price: 100, store: "C" },
  { price: 5000, store: "D" },
], "INR");
check(
  "saving outlier: when fewer than 2 distinct prices remain under threshold, saving is hidden",
  outlierFewRemain === null || outlierFewRemain.savingsPercent === 0,
);

/* Small-group (2-price) ratio checks */
const smallGroupOutlier = computeGroupSavings([
  { price: 802.27, store: "Amazon" },
  { price: 25090, store: "ImportStore" },
], "INR");
check(
  "saving outlier (small group): [802.27, 25090] max > 3x min excludes outlier → null",
  smallGroupOutlier === null,
  `got ${JSON.stringify(smallGroupOutlier)}`,
);

const smallGroupHonest = computeGroupSavings([
  { price: 600, store: "Nykaa" },
  { price: 1100, store: "Amazon" },
], "INR");
check(
  "saving outlier (small group): [600, 1100] max <= 3x min reports honest saving (45%)",
  smallGroupHonest !== null &&
    smallGroupHonest.savings === 500 &&
    smallGroupHonest.savingsPercent === 45,
  `savings=${smallGroupHonest?.savings} savingsPercent=${smallGroupHonest?.savingsPercent}`,
);

/* Bimodal 4-price cluster check (Cetaphil Redness fixture) */
const bimodalOutlier = computeGroupSavings([
  { price: 802.27, store: "Amazon" },
  { price: 978, store: "FirstCry" },
  { price: 17810.9, store: "GoSupps" },
  { price: 25090, store: "Desertcart" },
], "INR");
check(
  "saving outlier (bimodal 4-price): [802.27, 978, 17810.9, 25090] upper cluster excluded → savings 175.73, 18%",
  bimodalOutlier !== null &&
    bimodalOutlier.savings === 175.73 &&
    bimodalOutlier.savingsPercent === 18,
  `savings=${bimodalOutlier?.savings} savingsPercent=${bimodalOutlier?.savingsPercent}`,
);

console.log(failures === 0 ? "\nAll grouping checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
