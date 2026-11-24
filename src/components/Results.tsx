"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { refreshPrices, resolveLinks } from "@/lib/client-api";
import { applyLivePrices, detailRowKey, filterVisibleDetailRows } from "@/lib/detail-pricing";
import { formatPrice } from "@/lib/format";
import { computeGroupSavings, extractSize, sizesMatch } from "@/lib/grouping";
import type { Offer, ProductGroup, RefreshPricesResult, SearchResponse } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/types";
import { isDirectProductUrl, sanitizeProductUrl } from "@/lib/url";

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
  const offerSize = extractSize(offer.title);
  // Only pool sibling tokens that match the exact variant size and price band
  const compatible = groupOffers
    ? groupOffers.filter((o) => {
        const oSize = extractSize(o.title);
        if (offerSize && oSize && !sizesMatch(offerSize, oSize)) return false;
        if (offer.price > 0 && o.price > 0) {
          if (o.price > offer.price * 1.5 || o.price < offer.price / 1.5) return false;
        }
        return true;
      })
    : [offer];
  const ordered = [offer, ...compatible];
  const uniq = (pick: (o: Offer) => string | null) =>
    [...new Set(ordered.map(pick).filter((v): v is string => Boolean(v)))];
  return {
    productIds: uniq((o) => o.productId),
    catalogIds: uniq((o) => o.catalogId),
    productTokens: uniq((o) => o.productToken),
    immersiveTokens: uniq((o) => o.immersiveToken),
  };
}

/** An absolute http(s) URL with a real host — the only kind of URL
 *  ever opened from a store button. Empty strings, relative paths
 *  and non-http(s) schemes never reach window.open: opening an
 *  empty URL is what left users staring at a blank about:blank tab
 *  (live Nov 2026: a Nykaa "DIRECT LINK" opened a tab that never
 *  navigated anywhere). */
function isOpenableUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** True for any Google host (google.com, google.co.in,
 *  googleadservices.com, googlesyndication.com): a Google URL is
 *  never a store page, so it is never labelled or opened as one. */
function isGoogleUrl(value: string): boolean {
  try {
    return new URL(value).hostname.toLowerCase().includes("google");
  } catch {
    return false;
  }
}

function StoreButton({
  offer,
  groupOffers,
  warmedDirectUrl,
  onUnavailable,
}: {
  offer: Offer;
  groupOffers?: Offer[];
  /** Direct link warmed by the detail view's refresh (the server
   *  already resolved this row's store page). When present, the click
   *  opens it synchronously — no await, no blank tab, no resolve
   *  call. Absent while the refresh is pending, for rows beyond the
   *  refresh cap, or when the resolve produced nothing. */
  warmedDirectUrl?: string | null;
  onUnavailable?: () => void;
}) {
  const [state, setState] = useState<"idle" | "checking" | "nolink">("idle");
  // Only a validated direct merchant product URL counts: homepages, generic search
  // pages, and Google redirect URLs are rejected.
  const [direct, setDirect] = useState<string | null>(() => {
    if (offer.directUrl && isOpenableUrl(offer.directUrl) && isDirectProductUrl(offer.directUrl)) {
      return sanitizeProductUrl(offer.directUrl);
    }
    return null;
  });

  const pool = pooledIdentities(offer, groupOffers);
  const hasIdentity =
    pool.productIds.length > 0 ||
    pool.catalogIds.length > 0 ||
    pool.productTokens.length > 0 ||
    pool.immersiveTokens.length > 0;
  const canResolve =
    hasIdentity ||
    (Boolean(warmedDirectUrl) && isDirectProductUrl(warmedDirectUrl)) ||
    (Boolean(offer.productUrl) && isOpenableUrl(offer.productUrl)) ||
    (Boolean(offer.title?.trim()) && Boolean(offer.store?.trim()));

  async function go() {
    // A confirmed merchant product link opens synchronously — no await, no
    // blank tab, no resolve call.
    if (direct) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }
    if (warmedDirectUrl && isOpenableUrl(warmedDirectUrl) && isDirectProductUrl(warmedDirectUrl)) {
      const cleaned = sanitizeProductUrl(warmedDirectUrl);
      setDirect(cleaned);
      window.open(cleaned, "_blank", "noopener,noreferrer");
      return;
    }
    if (!canResolve) {
      setState("nolink");
      onUnavailable?.();
      return;
    }

    // Open the new tab synchronously within user gesture to prevent popup blocker dismissal
    let targetTab: Window | null = null;
    try {
      targetTab = window.open("about:blank", "_blank");
    } catch {
      // If popup blocker already blocked it, continue anyway
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
        productUrl: offer.productUrl ?? undefined,
        title: offer.title,
        store: offer.store,
        price: offer.price,
      });
      if (res.directUrl && isOpenableUrl(res.directUrl) && isDirectProductUrl(res.directUrl)) {
        const cleaned = sanitizeProductUrl(res.directUrl);
        setDirect(cleaned);
        setState("idle");
        if (targetTab && !targetTab.closed) {
          targetTab.location.replace(cleaned);
        } else {
          window.open(cleaned, "_blank", "noopener,noreferrer");
        }
        return;
      }
    } catch {
      // Resolution failed
    }

    // Direct product link could not be verified: close the pre-opened tab and surface
    // unavailable state honestly, never leaving a blank tab or opening invalid URLs.
    if (targetTab && !targetTab.closed) {
      try {
        targetTab.close();
      } catch {
        // Tab could not be closed
      }
    }
    setState("nolink");
    onUnavailable?.();
  }

  // When a verified direct merchant product URL is confirmed, render an outbound link.
  if (direct) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className="flag-direct">Direct link</span>
        <a
          href={direct}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-ghost"
        >
          Go to Store
        </a>
      </span>
    );
  }

  const isUnavailable = state === "nolink" || (!direct && !canResolve);
  const label = state === "checking" ? "Locating store…" : isUnavailable ? "Link unavailable" : "Go to Store";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={go}
        disabled={state === "checking" || isUnavailable}
      >
        {label}
      </button>
      {isUnavailable ? (
        <span className="small muted">Direct product page unavailable for this store.</span>
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
 *  Once any live price resolves, the rows re-sort by their effective
 *  (live-or-server) price and the cheapest flag + deltas recompute
 *  against the live lowest (see src/lib/detail-pricing.ts); until then
 *  the server order and server deltas stand. */
function StoreRows({
  group,
  showTitles = false,
  livePrices = {},
}: {
  group: ProductGroup;
  showTitles?: boolean;
  livePrices?: Record<string, RefreshPricesResult>;
}) {
  const [clickedFailedKeys, setClickedFailedKeys] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () => applyLivePrices(group.offers, livePrices, group.currency),
    [group, livePrices],
  );

  const { visibleRows, hiddenCount } = useMemo(
    () => filterVisibleDetailRows(rows, clickedFailedKeys),
    [rows, clickedFailedKeys],
  );

  return (
    <div className="store-rows">
      {visibleRows.map((row) => {
        const { offer, live } = row;
        const key = detailRowKey(offer, row.index);
        const livePrice = row.isLive ? row.effectivePrice : null;
        return (
          <div className="store-row" key={key}>
            <span className="store-name">{offer.store}</span>
            <span className="store-via">via {PROVIDER_LABELS[offer.provider]}</span>
            {row.isCheapest ? <span className="flag-cheapest">Lowest</span> : null}
            <span className="store-price">
              {livePrice !== null ? formatPrice(livePrice, "INR") : offer.priceLabel}
            </span>
            {livePrice !== null ? (
              <span
                className="flag-live"
                title={row.verifiedAt ? `Verified ${new Date(row.verifiedAt).toLocaleTimeString()}` : "Verified live"}
              >
                Live
              </span>
            ) : row.isUnverified ? (
              <span className="flag-unverified" title="Retailer price could not be verified automatically">
                Price needs verification
              </span>
            ) : null}
            {row.verifiedAt ? (
              <span className="verified-time small muted" style={{ fontSize: "0.72rem" }}>
                Verified {new Date(row.verifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
            {row.deltaLabel ? <span className="delta">{row.deltaLabel}</span> : null}
            <StoreButton
              offer={offer}
              groupOffers={group.offers}
              warmedDirectUrl={live?.directUrl}
              onUnavailable={() => setClickedFailedKeys((prev) => new Set(prev).add(key))}
            />
            {showTitles && offer.title !== group.title ? (
              <span className="store-listed-as">Listed as “{offer.title}”</span>
            ) : null}
          </div>
        );
      })}
      {hiddenCount > 0 ? (
        <div className="small muted store-rows-hidden-notice" style={{ marginTop: 12, textAlign: "center" }}>
          {hiddenCount} {hiddenCount === 1 ? "store" : "stores"} hidden — no direct product page found
        </div>
      ) : null}
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
      aria-label={`View all ${group.offers.length} ${group.offers.length === 1 ? "price" : "prices"} for ${group.title}`}
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
      <div className="group-cta" aria-hidden="true">
        <span>View all {group.offers.length} {group.offers.length === 1 ? "price" : "prices"}</span>
        <span className="group-cta-arrow">→</span>
      </div>
    </motion.article>
  );
}

interface PriceHistoryData {
  points: number;
  lowest: number | null;
  highest: number | null;
  current: number | null;
  series: Array<{ date: string; price: number }>;
}

function PriceHistorySection({ group }: { group: ProductGroup }) {
  const [data, setData] = useState<PriceHistoryData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!group.productKey) return;
    const controller = new AbortController();
    fetch(`/api/price-history?key=${encodeURIComponent(group.productKey)}&days=30`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Price history fetch failed");
        return res.json();
      })
      .then((resData: PriceHistoryData) => {
        setData(resData);
        setLoaded(true);
      })
      .catch(() => {
        // Loading and API-error states must hide the block silently.
        setLoaded(false);
      });
    return () => controller.abort();
  }, [group.productKey]);

  if (!loaded || !data) return null;

  if (data.points < 2) {
    return (
      <div
        className="price-history-card"
        style={{
          marginTop: 18,
          marginBottom: 16,
          padding: "12px 16px",
          background: "var(--cream-2, #f9fafb)",
          border: "1px solid var(--line, #e5e7eb)",
          borderRadius: "var(--radius-md, 12px)",
          color: "var(--ink-muted, #6b7280)",
          fontSize: "0.86rem",
          lineHeight: 1.4,
        }}
      >
        <div style={{ fontWeight: 600, color: "var(--ink, #111827)", marginBottom: 4 }}>Price history</div>
        <div>Price history is building — check back after more searches record prices.</div>
      </div>
    );
  }

  const width = 200;
  const height = 36;
  const padX = 8;
  const padY = 6;
  const graphWidth = width - padX * 2;
  const graphHeight = height - padY * 2;

  const minPrice = data.lowest ?? 0;
  const maxPrice = data.highest ?? minPrice;
  const priceRange = maxPrice > minPrice ? maxPrice - minPrice : 1;

  const pts = data.series.map((pt, i) => {
    const x = padX + (i / Math.max(1, data.series.length - 1)) * graphWidth;
    const y =
      maxPrice === minPrice
        ? height / 2
        : padY + graphHeight - ((pt.price - minPrice) / priceRange) * graphHeight;
    return { x, y };
  });

  const pointsStr = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div
      className="price-history-card"
      style={{
        marginTop: 18,
        marginBottom: 16,
        padding: "14px 18px",
        background: "var(--cream-2, #f9fafb)",
        border: "1px solid var(--line, #e5e7eb)",
        borderRadius: "var(--radius-md, 12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: "0.82rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            color: "var(--ink-muted, #6b7280)",
          }}
        >
          Price history (30 days)
        </span>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ overflow: "visible", flexShrink: 0 }}
          aria-hidden="true"
        >
          <polyline
            fill="none"
            stroke="var(--ink, #1f2937)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pointsStr}
          />
          {pts.length > 0 ? (
            <>
              <circle cx={pts[0].x} cy={pts[0].y} r="3" fill="var(--ink, #1f2937)" />
              <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill="var(--ink, #1f2937)" />
            </>
          ) : null}
        </svg>
      </div>
      <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--ink, #111827)" }}>
        Lowest in 30 days {formatPrice(data.lowest!, group.currency)} · Highest{" "}
        {formatPrice(data.highest!, group.currency)} · Now {formatPrice(data.current!, group.currency)}
      </div>
    </div>
  );
}

function TrackPriceSection({ group }: { group: ProductGroup }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [targetPrice, setTargetPrice] = useState(String(group.lowestPrice));
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setSuccessMsg(null);
    setErrorMsg(null);
    setTargetPrice(String(group.lowestPrice));
  }, [group]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_key: group.productKey,
          title: group.title,
          email,
          target_price: parseFloat(targetPrice),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to set price alert.");
      }
      setSuccessMsg(data.message || `We'll email you when this drops to ₹${targetPrice} or below.`);
      setOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 14, marginBottom: 16 }}>
      {successMsg ? (
        <div
          style={{
            padding: "10px 14px",
            background: "#ecfdf5",
            border: "1px solid #10b981",
            borderRadius: 8,
            color: "#065f46",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          ✓ {successMsg}
        </div>
      ) : !open ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={() => setOpen(true)}
        >
          <span>🔔</span> Track price
        </button>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{
            background: "var(--cream-2, #f9fafb)",
            border: "1px solid var(--line, #e5e7eb)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 420,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "var(--ink, #111827)" }}>
            Get an email when the price drops
          </div>
          {errorMsg ? (
            <div style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{errorMsg}</div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email address"
              required
              style={{
                flex: 1,
                minWidth: 180,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--line, #d1d5db)",
                fontSize: "0.88rem",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: "0.88rem", color: "var(--ink-muted, #6b7280)" }}>₹</span>
              <input
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="Target price"
                step="any"
                min="1"
                required
                style={{
                  width: 90,
                  padding: "8px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--line, #d1d5db)",
                  fontSize: "0.88rem",
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="submit"
              className="btn btn-sm btn-terra"
              disabled={loading}
              style={{ minWidth: 80 }}
            >
              {loading ? "Saving…" : "Set alert"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
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
        productUrl: offer.productUrl ?? undefined,
        title: offer.title,
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
        <PriceHistorySection group={group} />
        <TrackPriceSection group={group} />
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

  // A new search replaces the list, so any open detail view closes with it.
  useEffect(() => {
    setSelectedId(null);
  }, [results]);

  const groups = useMemo(() => {
    const list = [...results.groups];
    if (sort === "saving") list.sort((a, b) => b.savingsPercent - a.savingsPercent || a.lowestPrice - b.lowestPrice);
    // Default "lowest price" sort keeps the grouping tier order: real
    // multi-store comparisons first, then single-store groups, lowest
    // price within each tier.
    else list.sort((a, b) => (b.storeCount > 1 ? 1 : 0) - (a.storeCount > 1 ? 1 : 0) || a.lowestPrice - b.lowestPrice);
    return list;
  }, [results.groups, sort]);

  const selected = view === "groups" && selectedId ? groups.find((g) => g.id === selectedId) ?? null : null;

  const best = useMemo(() => {
    let pick: {
      group: ProductGroup;
      savingsLabel: string;
      savingsPercent: number;
      comparisonLabel: string;
    } | null = null;
    for (const g of results.groups) {
      const s = computeGroupSavings(g.offers, g.currency);
      if (s && s.savingsPercent > 0 && (!pick || s.savingsPercent > pick.savingsPercent)) {
        pick = {
          group: g,
          savingsLabel: s.savingsLabel,
          savingsPercent: s.savingsPercent,
          comparisonLabel: s.comparisonLabel,
        };
      }
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
                  on {best.group.title} — {best.group.lowestLabel} vs {best.comparisonLabel} across {best.group.storeCount} {best.group.storeCount === 1 ? "store" : "stores"}.
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
