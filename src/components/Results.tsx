"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { refreshPrices, resolveLinks } from "@/lib/client-api";
import { formatPrice } from "@/lib/format";
import type { Offer, ProductGroup, RefreshPricesResult, SearchResponse } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/types";

export type SortMode = "price" | "saving" | "stores" | "rating";
export type ViewMode = "groups" | "offers";

interface ResultsProps {
  results: SearchResponse;
  sort: SortMode;
  view: ViewMode;
  onSortChange: (s: SortMode) => void;
  onViewChange: (v: ViewMode) => void;
  onCompare: () => void;
}

/** Product thumbnail with a load-failure fallback. Plain img: provider
 *  thumbnails are hotlinked; next/image would need a remote allowlist.
 *  A failed load swaps to the same placeholder tile used when no image
 *  URL exists, so a broken image never shows. Callers key it by src so
 *  a new URL resets the failed state. */
function ProductThumb({
  src,
  imgClass,
  fallbackClass,
  eager = false,
}: {
  src: string | null;
  imgClass: string;
  fallbackClass: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={fallbackClass} aria-hidden="true">
        ✦
      </div>
    );
  }
  return (
    <img
      className={imgClass}
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** Identity pool for link resolution: the clicked offer's own ids/tokens
 *  first, then every sibling offer's ids/tokens from the same group (the
 *  group is one Google product, so a sibling SearchApi token or SerpApi
 *  immersive token can resolve a Serper offer's link). The store + price
 *  gate still uses the clicked offer only — never a sibling's. */
function pooledIdentities(offer: Offer, groupOffers: Offer[] | undefined) {
  const ordered = groupOffers ? [offer, ...groupOffers] : [offer];
  const uniq = (pick: (o: Offer) => string | null) =>
    [...new Set(ordered.map(pick).filter((v): v is string => Boolean(v)))];
  return {
    productIds: uniq((o) => o.productId),
    catalogIds: uniq((o) => o.catalogId),
    productTokens: uniq((o) => o.productToken),
    immersiveTokens: uniq((o) => o.immersiveToken),
  };
}

/** Minimal loading page written into the pre-opened tab while the
 *  resolve runs, so the user never stares at a blank about:blank page
 *  while waiting. Inline only — no external assets, no scripts. */
const LOADING_PAGE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store khul raha hai…</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#F9F2EC;color:#22301A;font-family:system-ui,-apple-system,sans-serif}.spin{width:28px;height:28px;border-radius:50%;border:3px solid #E3D9C8;border-top-color:#E36941;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="spin"></div><div>Store khul raha hai…</div></body></html>';

function StoreButton({
  offer,
  groupOffers,
  warmedDirectUrl,
}: {
  offer: Offer;
  groupOffers?: Offer[];
  /** Direct link warmed by the detail view's refresh (the server
   *  already resolved this row's store page). When present, the click
   *  opens it synchronously — no await, no blank tab, no resolve
   *  call. Absent while the refresh is pending, for rows beyond the
   *  refresh cap, or when the resolve produced nothing. */
  warmedDirectUrl?: string | null;
}) {
  const [state, setState] = useState<"idle" | "checking" | "fallback">("idle");
  const [direct, setDirect] = useState<string | null>(offer.directUrl);

  async function go() {
    if (direct) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }
    if (warmedDirectUrl) {
      window.open(warmedDirectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const pool = pooledIdentities(offer, groupOffers);
    const hasIdentity =
      pool.productIds.length > 0 ||
      pool.catalogIds.length > 0 ||
      pool.productTokens.length > 0 ||
      pool.immersiveTokens.length > 0;
    if (!offer.productUrl && !hasIdentity) return;
    // Open the tab synchronously inside the click gesture: opening it
    // after the awaited resolve gets blocked as a pop-up (notably by
    // Android Chrome). The tab is navigated once the link is known, or
    // closed when there is nothing to open.
    const tab = window.open("", "_blank", "noopener,noreferrer");
    if (tab) {
      try {
        tab.document.write(LOADING_PAGE_HTML);
        tab.document.close();
      } catch {
        // A tab that refuses the write still navigates below.
      }
    }
    setState("checking");
    try {
      const res = await resolveLinks({
        productId: offer.productId ?? undefined,
        catalogId: offer.catalogId ?? undefined,
        productIds: pool.productIds,
        catalogIds: pool.catalogIds,
        productToken: offer.productToken ?? undefined,
        productTokens: pool.productTokens,
        immersiveTokens: pool.immersiveTokens,
        store: offer.store,
        price: offer.price,
      });
      if (res.directUrl) {
        setDirect(res.directUrl);
        setState("idle");
        if (tab) tab.location.href = res.directUrl;
        else window.open(res.directUrl, "_blank", "noopener,noreferrer");
        return;
      }
    } catch {
      // Fall through to the Google Shopping page below.
    }
    setState("fallback");
    if (offer.productUrl) {
      if (tab) tab.location.href = offer.productUrl;
      else window.open(offer.productUrl, "_blank", "noopener,noreferrer");
    } else if (tab) {
      tab.close();
    }
  }

  const label = direct ? "Go to Store" : state === "checking" ? "Checking link…" : state === "fallback" ? "Via Google Shopping" : "Go to Store";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {direct ? <span className="flag-direct">Direct link</span> : null}
      <button type="button" className="btn btn-sm btn-ghost" onClick={go} disabled={state === "checking"}>
        {label}
      </button>
      {state === "fallback" && !direct ? (
        <span className="small muted">No exact store match — opened via Google Shopping.</span>
      ) : null}
    </span>
  );
}

/** All compared store rows for one product group, cheapest first (grouping
 *  already sorts offers by price and marks the cheapest + deltas). When
 *  showTitles is set, a row whose listing title differs from the group
 *  title shows it, so the shopper can confirm it is the same variant.
 *  Rows with a refreshed live price (INR only) show it with a LIVE
 *  badge; every other row keeps its Google snapshot price silently.
 *  Each row also carries a mini bar showing where its Google snapshot
 *  price sits between the group's lowest and highest price: the
 *  cheapest row's fill is lime, other rows olive, and when every price
 *  is equal the bar is a full-width neutral bar (never a division by
 *  zero). Bars always use the snapshot prices, even when a live price
 *  is shown — the live price is one store's page, not the comparison
 *  range. The bar is decorative (the price is in text beside it), so it
 *  is hidden from assistive tech. */
function StoreRows({
  group,
  showTitles = false,
  livePrices = {},
}: {
  group: ProductGroup;
  showTitles?: boolean;
  livePrices?: Record<string, RefreshPricesResult>;
}) {
  const reduceMotion = useReducedMotion();
  const low = group.lowestPrice;
  const high = group.highestPrice;
  const flat = high <= low;
  return (
    <div className="store-rows">
      {group.offers.map((offer, i) => {
        const key = `${offer.store}-${offer.price}-${i}`;
        const live = livePrices[key];
        const livePrice =
          live && live.status === "live" && live.currency === "INR" ? live.livePrice : null;
        // Position of this row's price in the group range. The 8% floor
        // keeps the cheapest row's lime segment visible instead of an
        // empty track; the exact price is always in text beside the bar.
        const pct = flat ? 1 : Math.max(0.08, Math.min(1, (offer.price - low) / (high - low)));
        return (
          <div className="store-row" key={key}>
            <span className="store-name">{offer.store}</span>
            <span className="store-via">via {PROVIDER_LABELS[offer.provider]}</span>
            {offer.isCheapest ? <span className="flag-cheapest">Lowest</span> : null}
            <span className="store-price">
              {livePrice !== null ? formatPrice(livePrice, "INR") : offer.priceLabel}
            </span>
            {livePrice !== null ? <span className="flag-live">Live</span> : null}
            {offer.deltaLabel ? <span className="delta">{offer.deltaLabel}</span> : null}
            <StoreButton offer={offer} groupOffers={group.offers} warmedDirectUrl={live?.directUrl} />
            {showTitles && offer.title !== group.title ? (
              <span className="store-listed-as">Listed as “{offer.title}”</span>
            ) : null}
            <div className="store-row-bar" aria-hidden="true">
              <div className="store-row-bar-track">
                <motion.div
                  className={`store-row-bar-fill${flat ? " is-flat" : offer.isCheapest ? " is-cheapest" : ""}`}
                  initial={reduceMotion ? false : { scaleX: 0 }}
                  animate={{ scaleX: pct }}
                  transition={{ type: "spring", stiffness: 80, damping: 20 }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Price-span bar on a group card: a track running from the group's
 *  cheapest offer to its most expensive, with one dot per distinct
 *  offer price along it and the lowest price marked in terracotta. The
 *  end labels reuse the group's own lowestLabel/highestLabel — no price
 *  is ever invented. A group with a single price (one store, or every
 *  store at the same price) shows one centred dot and one label, never
 *  a fake range. Decorative: the same prices are in text on the card,
 *  so the bar is hidden from assistive tech. */
function GroupPriceBar({ group }: { group: ProductGroup }) {
  const reduceMotion = useReducedMotion();
  const low = group.lowestPrice;
  const high = group.highestPrice;
  const flat = group.offers.length < 2 || high <= low;
  if (flat) {
    return (
      <div className="price-span" aria-hidden="true">
        <div className="price-span-track">
          <span className="price-span-line" />
          <span className="price-span-dot is-only" />
        </div>
        <div className="price-span-labels is-single">
          <span>{group.lowestLabel}</span>
        </div>
      </div>
    );
  }
  const seen = new Set<number>();
  const dots = group.offers
    .map((o) => ({ pct: ((o.price - low) / (high - low)) * 100, cheapest: o.price === low }))
    .filter((d) => {
      const bucket = Math.round(d.pct * 10);
      if (seen.has(bucket)) return false;
      seen.add(bucket);
      return true;
    });
  return (
    <div className="price-span" aria-hidden="true">
      <div className="price-span-track">
        <motion.div
          className="price-span-line"
          initial={reduceMotion ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ type: "spring", stiffness: 80, damping: 20 }}
        />
        {dots.map((d, i) => (
          <motion.span
            key={`${Math.round(d.pct * 10)}-${i}`}
            className={`price-span-dot${d.cheapest ? " is-lowest" : ""}`}
            style={{ left: `${d.pct}%`, x: "-50%" }}
            initial={reduceMotion ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.08 + i * 0.04 }}
          />
        ))}
      </div>
      <div className="price-span-labels">
        <span>{group.lowestLabel}</span>
        <span>{group.highestLabel}</span>
      </div>
    </div>
  );
}

/** Summary card in the grouped list: product + lowest price + an obvious
 *  affordance. Clicking (or Enter/Space) opens the detail view with every
 *  compared price. The card holds no other interactive elements, so the
 *  whole card can safely act as one large click target. */
function GroupCard({ group, onOpen }: { group: ProductGroup; onOpen: (g: ProductGroup) => void }) {
  return (
    <motion.article
      className="group-card group-card-clickable"
      layout
      initial={{ y: 16 }}
      animate={{ y: 0 }}
      exit={{ y: 8 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
      role="button"
      tabIndex={0}
      aria-label={`View all ${group.storeCount} ${group.storeCount === 1 ? "price" : "prices"} for ${group.title}`}
      onClick={() => onOpen(group)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(group);
        }
      }}
    >
      <div className="group-top">
        <ProductThumb
          key={group.imageUrl ?? "none"}
          src={group.imageUrl}
          imgClass="group-thumb"
          fallbackClass="group-thumb-fallback"
        />
        <div style={{ minWidth: 0 }}>
          <h3 className="group-title">{group.title}</h3>
          <div className="group-meta">
            <span>{group.storeCount} {group.storeCount === 1 ? "store" : "stores"}</span>
            {group.rating !== null ? <span>★ {group.rating.toFixed(1)}{group.reviews ? ` (${group.reviews.toLocaleString("en-IN")} reviews)` : ""}</span> : null}
            {group.savingsPercent > 0 ? <span>Save up to {group.savingsLabel} ({group.savingsPercent}%)</span> : null}
          </div>
        </div>
        <div className="group-price">
          <div className="low">{group.lowestLabel}</div>
          <div className="range">up to {group.highestLabel}</div>
        </div>
      </div>
      <div className="group-mini-rows">
        {group.offers.slice(0, 3).map((offer, i) => (
          <div className="group-mini-row" key={`${offer.store}-${offer.price}-${i}`}>
            <span className="store-name">{offer.store}</span>
            {offer.isCheapest ? <span className="flag-cheapest">Lowest</span> : null}
            <span className="store-price">{offer.priceLabel}</span>
            {offer.deltaLabel ? <span className="delta">{offer.deltaLabel}</span> : null}
          </div>
        ))}
      </div>
      <GroupPriceBar group={group} />
      <div className="group-cta" aria-hidden="true">
        <span>View all {group.storeCount} {group.storeCount === 1 ? "price" : "prices"}</span>
        <span className="group-cta-arrow">→</span>
      </div>
    </motion.article>
  );
}

/** Focused detail view for one product: name, image, variant summary, and
 *  every compared store price with a working store link per row. Opening
 *  the detail fires one live-price refresh for the group's rows; the
 *  header stats stay the Google snapshot (the disclaimer below them
 *  says so). The refresh results also warm each row's store link: the
 *  server already resolved the store page, so a warmed row opens it
 *  synchronously on click instead of resolving again. */
function ProductDetail({ group, onBack }: { group: ProductGroup; onBack: () => void }) {
  const [livePrices, setLivePrices] = useState<Record<string, RefreshPricesResult>>({});

  useEffect(() => {
    const controller = new AbortController();
    const items = group.offers.map((offer, i) => {
      const pool = pooledIdentities(offer, group.offers);
      return {
        key: `${offer.store}-${offer.price}-${i}`,
        store: offer.store,
        price: offer.price,
        productId: offer.productId ?? undefined,
        catalogId: offer.catalogId ?? undefined,
        productIds: pool.productIds,
        catalogIds: pool.catalogIds,
        productToken: offer.productToken ?? undefined,
        productTokens: pool.productTokens,
        immersiveTokens: pool.immersiveTokens,
      };
    });
    refreshPrices({ items }, controller.signal)
      .then((res) => {
        const map: Record<string, RefreshPricesResult> = {};
        for (const r of res.results) map[r.key] = r;
        setLivePrices(map);
      })
      .catch(() => {
        // Silent: any failure (including abort on back/unmount) leaves
        // the Google snapshot prices on screen.
      });
    return () => controller.abort();
  }, [group]);

  return (
    <motion.div
      initial={{ y: 16 }}
      animate={{ y: 0 }}
      exit={{ y: 8 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
    >
      <button type="button" className="btn btn-sm btn-ghost detail-back" onClick={onBack}>
        ← Back to results
      </button>
      <div className="detail-card">
        <div className="detail-top">
          <ProductThumb
            key={group.imageUrl ?? "none"}
            src={group.imageUrl}
            imgClass="detail-thumb"
            fallbackClass="detail-thumb-fallback"
            eager
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="detail-title">{group.title}</h3>
            <div className="group-meta">
              <span>{group.storeCount} {group.storeCount === 1 ? "store" : "stores"} compared</span>
              {group.rating !== null ? <span>★ {group.rating.toFixed(1)}{group.reviews ? ` (${group.reviews.toLocaleString("en-IN")} reviews)` : ""}</span> : null}
              <span>Same variant matched across stores</span>
            </div>
            <div className="detail-summary">
              <div className="detail-stat">
                <span className="detail-stat-label">Lowest</span>
                <span className="detail-stat-value">{group.lowestLabel}</span>
              </div>
              <div className="detail-stat">
                <span className="detail-stat-label">Highest</span>
                <span className="detail-stat-value">{group.highestLabel}</span>
              </div>
              {group.savingsPercent > 0 ? (
                <div className="detail-stat detail-stat-save">
                  <span className="detail-stat-label">You save up to</span>
                  <span className="detail-stat-value">{group.savingsLabel} ({group.savingsPercent}%)</span>
                </div>
              ) : null}
            </div>
            <div className="small muted">Prices are from Google Shopping — the store&rsquo;s live price may differ.</div>
          </div>
        </div>
        <StoreRows group={group} showTitles livePrices={livePrices} />
      </div>
      <button type="button" className="btn btn-sm btn-ghost detail-back-bottom" onClick={onBack}>
        ← Back to results
      </button>
    </motion.div>
  );
}

function scrollToResults() {
  document.getElementById("results-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Results({ results, sort, view, onSortChange, onViewChange, onCompare }: ResultsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Toolbar filters: client-side only, over the groups already returned.
  // A store chip keeps groups with at least one offer from that store;
  // several chips act as an OR. The multi-store toggle hides
  // single-store groups. Both reset with every new search.
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [multiStoreOnly, setMultiStoreOnly] = useState(false);

  // A new search replaces the list, so any open detail view closes with
  // it and the toolbar filters reset (store names are per-search).
  useEffect(() => {
    setSelectedId(null);
    setSelectedStores([]);
    setMultiStoreOnly(false);
  }, [results]);

  const groups = useMemo(() => {
    const list = [...results.groups];
    if (sort === "saving") list.sort((a, b) => b.savingsPercent - a.savingsPercent || a.lowestPrice - b.lowestPrice);
    else if (sort === "stores") list.sort((a, b) => b.storeCount - a.storeCount || a.lowestPrice - b.lowestPrice);
    // Top rated: highest rating first, more reviews breaking ties, then
    // lowest price. Groups without a rating sort last.
    else if (sort === "rating") list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviews ?? 0) - (a.reviews ?? 0) || a.lowestPrice - b.lowestPrice);
    // Default "lowest price" sort keeps the grouping tier order: real
    // multi-store comparisons first, then single-store groups, lowest
    // price within each tier.
    else list.sort((a, b) => (b.storeCount > 1 ? 1 : 0) - (a.storeCount > 1 ? 1 : 0) || a.lowestPrice - b.lowestPrice);
    return list;
  }, [results.groups, sort]);

  const stores = useMemo(() => {
    const set = new Set<string>();
    for (const g of results.groups) for (const o of g.offers) set.add(o.store);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [results.groups]);

  const visibleGroups = useMemo(() => {
    let list = groups;
    if (selectedStores.length > 0) {
      const wanted = new Set(selectedStores);
      list = list.filter((g) => g.offers.some((o) => wanted.has(o.store)));
    }
    if (multiStoreOnly) list = list.filter((g) => g.storeCount > 1);
    return list;
  }, [groups, selectedStores, multiStoreOnly]);

  const filtersActive = selectedStores.length > 0 || multiStoreOnly;

  const selected = view === "groups" && selectedId ? groups.find((g) => g.id === selectedId) ?? null : null;

  const best = useMemo(() => {
    // The banner highlights the biggest saving among the products
    // actually on screen: the filtered groups in the grouped view, all
    // groups in the flat view (which the toolbar does not filter).
    const pool = view === "groups" ? visibleGroups : results.groups;
    let pick: ProductGroup | null = null;
    for (const g of pool) {
      if (g.savingsPercent > 0 && (!pick || g.savingsPercent > pick.savingsPercent)) pick = g;
    }
    return pick;
  }, [visibleGroups, results.groups, view]);

  function toggleStore(store: string) {
    setSelectedStores((prev) => (prev.includes(store) ? prev.filter((s) => s !== store) : [...prev, store]));
  }

  function clearFilters() {
    setSelectedStores([]);
    setMultiStoreOnly(false);
  }

  function openDetail(group: ProductGroup) {
    setSelectedId(group.id);
    scrollToResults();
  }

  function closeDetail() {
    setSelectedId(null);
    scrollToResults();
  }

  function handleViewChange(v: ViewMode) {
    setSelectedId(null);
    onViewChange(v);
  }

  function handleSortChange(s: SortMode) {
    setSelectedId(null);
    onSortChange(s);
  }

  return (
    <div id="results">
      <div className="results-head">
        <h2 className="display">
          Results for “{results.query}”
        </h2>
        <div className="results-controls">
          <div className="seg" role="group" aria-label="Result view">
            <button type="button" aria-pressed={view === "groups"} onClick={() => handleViewChange("groups")}>Grouped</button>
            <button type="button" aria-pressed={view === "offers"} onClick={() => handleViewChange("offers")}>All offers</button>
          </div>
          <label className="small muted" htmlFor="sort-select">Sort</label>
          <select id="sort-select" className="select" value={sort} onChange={(e) => handleSortChange(e.target.value as SortMode)}>
            <option value="price">Lowest price</option>
            <option value="saving">Biggest saving</option>
            <option value="stores">Most stores</option>
            <option value="rating">Top rated</option>
          </select>
          <button type="button" className="btn btn-sm" onClick={onCompare}>Deep compare</button>
        </div>
      </div>

      {results.providerErrors.length > 0 ? (
        <div className="provider-errors" role="alert">
          {results.providerErrors.map((e) => (
            <span key={e.provider} className="provider-error-chip">
              {PROVIDER_LABELS[e.provider]} failed: {e.message}
            </span>
          ))}
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <ProductDetail key={`detail-${selected.id}`} group={selected} onBack={closeDetail} />
        ) : (
          <motion.div
            key="results-list"
            initial={{ y: 12 }}
            animate={{ y: 0 }}
            exit={{ y: 6 }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          >
            {best ? (
              <div className="savings-banner">
                <span aria-hidden="true">✦</span>
                <strong>Biggest saving: {best.savingsLabel} ({best.savingsPercent}%)</strong>
                <span className="muted small">
                  on {best.title} — {best.lowestLabel} vs {best.highestLabel} across {best.storeCount} {best.storeCount === 1 ? "store" : "stores"}.
                </span>
              </div>
            ) : null}

            {groups.length > 0 && view === "groups" ? (
              <div className="results-toolbar">
                <span className="toolbar-label">Stores</span>
                <div className="filter-chips" role="group" aria-label="Filter by store">
                  {stores.map((store) => (
                    <button
                      type="button"
                      key={store}
                      className="filter-chip"
                      aria-pressed={selectedStores.includes(store)}
                      onClick={() => toggleStore(store)}
                    >
                      {store}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="filter-chip filter-toggle"
                  aria-pressed={multiStoreOnly}
                  onClick={() => setMultiStoreOnly((v) => !v)}
                >
                  Multi-store only
                </button>
                {filtersActive ? (
                  <>
                    <button type="button" className="filter-clear" onClick={clearFilters}>
                      Clear filters
                    </button>
                    <span className="filter-count">
                      Showing {visibleGroups.length} of {groups.length} {groups.length === 1 ? "product" : "products"}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}

            {groups.length === 0 ? (
              <div className="empty-state">
                <p className="display" style={{ fontSize: "1.3rem", margin: "0 0 8px" }}>No priced results found.</p>
                <p className="muted" style={{ margin: 0 }}>
                  The providers returned nothing with a price for this query. Try a different product name or a broader term.
                </p>
              </div>
            ) : view === "groups" ? (
              visibleGroups.length === 0 ? (
                <div className="empty-state">
                  <p className="display" style={{ fontSize: "1.3rem", margin: "0 0 8px" }}>No products match these filters.</p>
                  <p className="muted" style={{ margin: "0 0 14px" }}>
                    Try removing a store or turning off “Multi-store only”.
                  </p>
                  <button type="button" className="btn btn-sm" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              ) : (
                <motion.div layout>
                  <AnimatePresence initial={false}>
                    {visibleGroups.map((g) => (
                      <GroupCard key={g.id} group={g} onOpen={openDetail} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )
            ) : (
              <motion.div layout>
                <AnimatePresence initial={false}>
                  {results.offers.map((offer, i) => {
                    // Flat offers are copies of the grouped ones (JSON
                    // round-trip), so match the enclosing group by value
                    // to pool its ids/tokens for link resolution.
                    const group = results.groups.find((g) =>
                      g.offers.some((o) => o.store === offer.store && o.title === offer.title && o.price === offer.price),
                    );
                    return (
                    <motion.div
                      className="offer-row"
                      key={`${offer.store}-${offer.title}-${offer.price}-${i}`}
                      layout
                      initial={{ y: 12 }}
                      animate={{ y: 0 }}
                      exit={{ y: 6 }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    >
                      <ProductThumb
                        key={offer.imageUrl ?? "none"}
                        src={offer.imageUrl}
                        imgClass="offer-thumb"
                        fallbackClass="offer-thumb-fallback"
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{offer.title}</div>
                        <div className="small muted">
                          {offer.store} · via {PROVIDER_LABELS[offer.provider]}
                          {offer.rating !== null ? ` · ★ ${offer.rating.toFixed(1)}` : ""}
                        </div>
                      </div>
                      <span className="store-price">{offer.priceLabel}</span>
                      <StoreButton offer={offer} groupOffers={group?.offers} />
                    </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
