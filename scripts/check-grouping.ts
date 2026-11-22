/**
 * Fixture-based verification for the grouping engine.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:grouping
 */
import { buildGroups, dedupeOffers, extractBrand, extractMultipack, extractQueryBrand, extractSize, hasBundleMismatch, hasDistinctiveTokens, isBundleTitle, sizesMatch } from "../src/lib/grouping";
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
 * lines apart. Catalog-id matching is untouched by the guards. */

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

/* Guards never apply to catalog-id matching: the catalog rule is unchanged. */
const catalogIgnoresGuards = buildGroups(dedupeOffers([
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50", store: "Nykaa", price: 400, catalogId: "CATG" }),
  offer({ title: "Dot & Key Vitamin C + E Super Bright Sunscreen SPF 50 Combo", store: "Amazon.in", price: 700, catalogId: "CATG" }),
]), "INR");
check("catalogId match still merges even with a bundle word", catalogIgnoresGuards.length === 1, `got ${catalogIgnoresGuards.length} groups`);

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

console.log(failures === 0 ? "\nAll grouping checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
