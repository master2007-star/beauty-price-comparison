import { matchesRequiredVariant, requiredVariantTitle } from "./variant-validation";
import type { Offer } from "./types";

/** A pool is a search aid, never evidence that the retailer PDP has the same variant. */
export function pooledIdentities(offer: Offer, siblings?: Offer[], groupTitle?: string) {
  const wanted = requiredVariantTitle(groupTitle ?? offer.title, [offer.title, ...(siblings ?? []).map((o) => o.title)]);
  const compatible = (siblings ?? []).filter((other) => matchesRequiredVariant(wanted, other.title));
  const ordered = [offer, ...compatible];
  const unique = (pick: (o: Offer) => string | null) =>
    [...new Set(ordered.map(pick).filter((v): v is string => Boolean(v)))];
  return {
    productIds: unique((o) => o.productId), catalogIds: unique((o) => o.catalogId),
    productTokens: unique((o) => o.productToken), immersiveTokens: unique((o) => o.immersiveToken),
  };
}
