/**
 * Search orchestration: fan out to every configured provider in parallel,
 * merge + dedupe, group into same-product variants, sort lowest first.
 * Provider failures become providerErrors — never fake data.
 */
import { configuredProviders, envVarName, getConfig, type AppConfig } from "./env";
import { defaultCurrencyForRegion } from "./format";
import { filterBeautyOffers, isBeautyQuery } from "./beauty-filter";
import { buildGroups, dedupeOffers, extractQueryBrand, flattenOffers } from "./grouping";
import {
  isProviderQuotaExhausted,
  recordProviderResult,
} from "./provider-health";
import { PROVIDER_FETCHERS } from "./providers";
import type {
  AlignedMatch,
  CompareResponse,
  CompareResult,
  ProviderError,
  ProviderId,
  RawOffer,
  SearchResponse,
} from "./types";
import { PROVIDER_IDS } from "./types";

export function noProvidersMessage(cfg: AppConfig): string {
  return (
    "No provider API key is configured. Set at least one of " +
    "SERPAPI_KEY, SEARCHAPI_KEY, SERPER_KEY or SEARLO_KEY " +
    `(region: ${cfg.region}, language: ${cfg.language}) to search live prices.`
  );
}

export async function runSearch(query: string, cfg: AppConfig = getConfig()): Promise<SearchResponse> {
  const searchedAt = new Date().toISOString();

  // Query-level beauty guard, BEFORE any provider call: a deliberately
  // non-beauty query ("badminton racket") must not spend provider credits
  // — and the title filter alone cannot catch brand-only listings whose
  // titles carry no category words. Same rule as the title filter
  // (denylist signal + zero beauty signals). Returns the same empty shape
  // as a zero-group search; the UI's honest no-results state covers the
  // display. runCompare inherits this via runSearch.
  if (!isBeautyQuery(query)) {
    return {
      query,
      status: "ok",
      providersUsed: [],
      providerErrors: [],
      groups: [],
      offers: [],
      searchedAt,
    };
  }

  const providers = configuredProviders(cfg);

  if (providers.length === 0) {
    return {
      query,
      status: "no_providers",
      providersUsed: [],
      providerErrors: [],
      groups: [],
      offers: [],
      searchedAt,
      message: noProvidersMessage(cfg),
    };
  }

  // Skip providers whose monthly quota is known-exhausted (and not
  // yet due a re-probe): calling them would only return the same 429.
  // The skip is reported as a provider error so the UI stays honest
  // about why one source is missing. A successful re-probe clears
  // the mark automatically.
  const activeProviders = providers.filter((id) => !isProviderQuotaExhausted(id));
  const skippedProviders = providers.filter((id) => isProviderQuotaExhausted(id));

  const settled = await Promise.allSettled(
    activeProviders.map(async (id) => ({ id, offers: await PROVIDER_FETCHERS[id](query, cfg) })),
  );

  const offers: RawOffer[] = [];
  const providerErrors: ProviderError[] = [];
  const providersUsed: ProviderId[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      providersUsed.push(result.value.id);
      offers.push(...result.value.offers);
      recordProviderResult(result.value.id, null);
    } else {
      // Promise.allSettled loses the id on rejection; recover it by index.
      const idx = settled.indexOf(result);
      const id = activeProviders[idx];
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      providerErrors.push({ provider: id, message });
      recordProviderResult(id, message);
    }
  }
  for (const id of skippedProviders) {
    providerErrors.push({
      provider: id,
      message: "Monthly quota exhausted — searches continue on the other providers.",
    });
  }

  const deduped = dedupeOffers(offers);
  // Beauty-only site: drop obvious non-beauty fuzzy matches (sports gear,
  // electronics, groceries…) before grouping. Covers /api/compare too,
  // since runCompare delegates to runSearch.
  const relevant = filterBeautyOffers(deduped);
  const groups = buildGroups(relevant, defaultCurrencyForRegion(cfg.region), extractQueryBrand(query));
  return {
    query,
    status: "ok",
    providersUsed,
    providerErrors,
    groups,
    offers: flattenOffers(groups),
    searchedAt,
  };
}

function alignmentKey(groupTitle: string, catalogId: string | null, variantKey: string): string {
  if (catalogId) return `cat:${catalogId}:${variantKey}`;
  return `title:${groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}:${variantKey}`;
}

/**
 * Deep compare: run up to 3 queries, then align products that appear in
 * more than one query (catalog-anchored, size-strict via the grouping
 * variant signature of each group's first offer).
 */
export async function runCompare(queries: string[], cfg: AppConfig = getConfig()): Promise<CompareResponse> {
  const searchedAt = new Date().toISOString();
  const limited = queries.slice(0, 3);
  const results: CompareResult[] = await Promise.all(
    limited.map(async (q) => {
      const r = await runSearch(q, cfg);
      return {
        query: r.query,
        status: r.status,
        providersUsed: r.providersUsed,
        providerErrors: r.providerErrors,
        groups: r.groups,
        offers: r.offers,
      };
    }),
  );

  // Align groups across queries.
  const byKey = new Map<string, AlignedMatch & { seen: Set<string> }>();
  for (const result of results) {
    for (const group of result.groups) {
      const first = group.offers[0];
      const variantKey = first
        ? [
            first.catalogId ?? "",
            first.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join(" "),
          ].join("|")
        : "";
      const key = alignmentKey(group.title, first?.catalogId ?? null, variantKey);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          key,
          title: group.title,
          imageUrl: group.imageUrl,
          currency: group.currency,
          perQuery: [],
          seen: new Set(),
        };
        byKey.set(key, entry);
      }
      if (!entry.seen.has(result.query)) {
        entry.seen.add(result.query);
        entry.perQuery.push({
          query: result.query,
          lowestPrice: group.lowestPrice,
          lowestLabel: group.lowestLabel,
          storeCount: group.storeCount,
        });
      }
    }
  }

  const aligned: AlignedMatch[] = [...byKey.values()]
    .filter((e) => e.perQuery.length > 1)
    .map(({ seen: _seen, ...rest }) => rest)
    .sort((a, b) => a.title.localeCompare(b.title));

  return { queries: limited, results, aligned, searchedAt };
}

export function missingProviderHint(): string {
  return `Set one of: ${PROVIDER_IDS.map(envVarName).join(", ")}.`;
}
