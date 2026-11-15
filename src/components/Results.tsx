"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { resolveLinks } from "@/lib/client-api";
import type { Offer, ProductGroup, SearchResponse } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/types";

export type SortMode = "price" | "saving";
export type ViewMode = "groups" | "offers";

interface ResultsProps {
  results: SearchResponse;
  sort: SortMode;
  view: ViewMode;
  onSortChange: (s: SortMode) => void;
  onViewChange: (v: ViewMode) => void;
  onCompare: () => void;
}

function StoreButton({ offer }: { offer: Offer }) {
  const [state, setState] = useState<"idle" | "checking" | "fallback">("idle");
  const [direct, setDirect] = useState<string | null>(offer.directUrl);

  async function go() {
    if (direct) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }
    if (!offer.productUrl && !offer.productId && !offer.catalogId && !offer.productToken) return;
    setState("checking");
    try {
      const res = await resolveLinks({
        productId: offer.productId ?? undefined,
        catalogId: offer.catalogId ?? undefined,
        productToken: offer.productToken ?? undefined,
        store: offer.store,
        price: offer.price,
      });
      if (res.directUrl) {
        setDirect(res.directUrl);
        setState("idle");
        window.open(res.directUrl, "_blank", "noopener,noreferrer");
        return;
      }
    } catch {
      // Fall through to the Google Shopping page below.
    }
    setState("fallback");
    if (offer.productUrl) window.open(offer.productUrl, "_blank", "noopener,noreferrer");
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
 *  title shows it, so the shopper can confirm it is the same variant. */
function StoreRows({ group, showTitles = false }: { group: ProductGroup; showTitles?: boolean }) {
  return (
    <div className="store-rows">
      {group.offers.map((offer, i) => (
        <div className="store-row" key={`${offer.store}-${offer.price}-${i}`}>
          <span className="store-name">{offer.store}</span>
          <span className="store-via">via {PROVIDER_LABELS[offer.provider]}</span>
          {offer.isCheapest ? <span className="flag-cheapest">Lowest</span> : null}
          <span className="store-price">{offer.priceLabel}</span>
          {offer.deltaLabel ? <span className="delta">{offer.deltaLabel}</span> : null}
          <StoreButton offer={offer} />
          {showTitles && offer.title !== group.title ? (
            <span className="store-listed-as">Listed as “{offer.title}”</span>
          ) : null}
        </div>
      ))}
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
        {group.imageUrl ? (
          // Plain img: provider thumbnails are hotlinked; next/image would need a remote allowlist.
          <img className="group-thumb" src={group.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="group-thumb-fallback" aria-hidden="true">✦</div>
        )}
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
      <div className="group-cta" aria-hidden="true">
        <span>View all {group.storeCount} {group.storeCount === 1 ? "price" : "prices"}</span>
        <span className="group-cta-arrow">→</span>
      </div>
    </motion.article>
  );
}

/** Focused detail view for one product: name, image, variant summary, and
 *  every compared store price with a working store link per row. */
function ProductDetail({ group, onBack }: { group: ProductGroup; onBack: () => void }) {
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
          {group.imageUrl ? (
            <img className="detail-thumb" src={group.imageUrl} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="detail-thumb-fallback" aria-hidden="true">✦</div>
          )}
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
          </div>
        </div>
        <StoreRows group={group} showTitles />
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

  // A new search replaces the list, so any open detail view closes with it.
  useEffect(() => {
    setSelectedId(null);
  }, [results]);

  const groups = useMemo(() => {
    const list = [...results.groups];
    if (sort === "saving") list.sort((a, b) => b.savingsPercent - a.savingsPercent || a.lowestPrice - b.lowestPrice);
    else list.sort((a, b) => a.lowestPrice - b.lowestPrice);
    return list;
  }, [results.groups, sort]);

  const selected = view === "groups" && selectedId ? groups.find((g) => g.id === selectedId) ?? null : null;

  const best = useMemo(() => {
    let pick: ProductGroup | null = null;
    for (const g of results.groups) {
      if (g.savingsPercent > 0 && (!pick || g.savingsPercent > pick.savingsPercent)) pick = g;
    }
    return pick;
  }, [results.groups]);

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

            {groups.length === 0 ? (
              <div className="empty-state">
                <p className="display" style={{ fontSize: "1.3rem", margin: "0 0 8px" }}>No priced results found.</p>
                <p className="muted" style={{ margin: 0 }}>
                  The providers returned nothing with a price for this query. Try a different product name or a broader term.
                </p>
              </div>
            ) : view === "groups" ? (
              <motion.div layout>
                <AnimatePresence initial={false}>
                  {groups.map((g) => (
                    <GroupCard key={g.id} group={g} onOpen={openDetail} />
                  ))}
                </AnimatePresence>
              </motion.div>
            ) : (
              <motion.div layout>
                <AnimatePresence initial={false}>
                  {results.offers.map((offer, i) => (
                    <motion.div
                      className="offer-row"
                      key={`${offer.store}-${offer.title}-${offer.price}-${i}`}
                      layout
                      initial={{ y: 12 }}
                      animate={{ y: 0 }}
                      exit={{ y: 6 }}
                      transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    >
                      {offer.imageUrl ? <img src={offer.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{offer.title}</div>
                        <div className="small muted">
                          {offer.store} · via {PROVIDER_LABELS[offer.provider]}
                          {offer.rating !== null ? ` · ★ ${offer.rating.toFixed(1)}` : ""}
                        </div>
                      </div>
                      <span className="store-price">{offer.priceLabel}</span>
                      <StoreButton offer={offer} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
