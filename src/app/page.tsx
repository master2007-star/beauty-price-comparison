"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import CompareModal from "@/components/CompareModal";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Results, { type SortMode, type ViewMode } from "@/components/Results";
import { CategoryBento, ClosingCta, Faq, StatsBand, WhyCards, type LiveStats } from "@/components/Sections";
import StickySearch from "@/components/StickySearch";
import { LockedError, searchProducts } from "@/lib/client-api";
import type { SearchResponse } from "@/lib/types";

export default function HomePage() {
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState<SortMode>("price");
  const [view, setView] = useState<ViewMode>("groups");
  const [compareOpen, setCompareOpen] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const res = await searchProducts(q);
      setResults(res);
    } catch (e) {
      if (e instanceof LockedError) return; // LockGate re-opens.
      setError(e instanceof Error ? e.message : "Search failed.");
      setResults(null);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        document.getElementById("results-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  const stats: LiveStats = useMemo(() => {
    if (!results || results.status !== "ok") {
      return { storeCount: null, offerCount: null, bestSavingLabel: null, bestSavingPercent: null, searched };
    }
    const stores = new Set(results.offers.map((o) => o.store.toLowerCase()));
    let best: { label: string; pct: number } | null = null;
    for (const g of results.groups) {
      if (g.savingsPercent > 0 && (!best || g.savingsPercent > best.pct)) {
        best = { label: g.savingsLabel, pct: g.savingsPercent };
      }
    }
    return {
      storeCount: stores.size,
      offerCount: results.offers.length,
      bestSavingLabel: best?.label ?? null,
      bestSavingPercent: best?.pct ?? null,
      searched,
    };
  }, [results, searched]);

  const marqueeStores = useMemo(() => {
    if (!results) return [];
    const seen = new Map<string, string>();
    for (const o of results.offers) {
      const key = o.store.toLowerCase();
      if (!seen.has(key)) seen.set(key, o.store);
    }
    return [...seen.values()].slice(0, 12);
  }, [results]);

  return (
    <>
      <StickySearch loading={loading} onSearch={runSearch} />
      <Hero loading={loading} onSearch={runSearch} />
      <Marquee stores={marqueeStores} />

      <div id="results-anchor" ref={resultsRef} style={{ scrollMarginTop: 72 }}>
        {loading ? (
          <div className="wrap">
            <div className="loading-dots" role="status" aria-label="Searching">
              <span className="dot-pulse" />
              <span className="dot-pulse" />
              <span className="dot-pulse" />
              <span>Checking live prices across stores…</span>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="wrap">
            <div className="notice notice-error" role="alert">
              <h3>Search failed</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {results?.status === "no_providers" ? (
          <div className="wrap">
            <div className="notice" role="alert">
              <h3>No provider keys configured</h3>
              <p>
                {results.message} Set them in <code>.env.local</code> for local development, or in Vercel → Project
                → Settings → Environment Variables, then redeploy. At least one key is needed for live prices.
              </p>
              <p style={{ marginTop: 10 }}>
                <a href="/settings">See provider status and setup →</a>
              </p>
            </div>
          </div>
        ) : null}

        {results && results.status === "ok" ? (
          <section className="section" style={{ paddingBottom: 8 }} aria-label="Search results">
            <div className="wrap">
              <Results
                results={results}
                sort={sort}
                view={view}
                onSortChange={setSort}
                onViewChange={setView}
                onCompare={() => setCompareOpen(true)}
              />
            </div>
          </section>
        ) : null}
      </div>

      <CategoryBento onSearch={runSearch} />
      <StatsBand stats={stats} />
      <WhyCards />
      <Faq />
      <ClosingCta
        onStart={() => {
          document.getElementById("hero-search")?.focus();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <CompareModal
        open={compareOpen}
        initialQueries={results ? [results.query] : []}
        onClose={() => setCompareOpen(false)}
      />
    </>
  );
}
