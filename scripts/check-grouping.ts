/**
 * Fixture-based verification for the grouping engine.
 * No network, no provider keys — pure unit-level checks.
 * Run: npm run check:grouping
 */
import { buildGroups, dedupeOffers, extractSize, sizesMatch } from "../src/lib/grouping";
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
check("groups sorted lowest-first", groups.every((g, i) => i === 0 || g.lowestPrice >= groups[i - 1].lowestPrice));

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
check("missing size without catalogId still splits", noCatalogMissingSize.length === 2, `got ${noCatalogMissingSize.length} groups`);

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

console.log(failures === 0 ? "\nAll grouping checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
