"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CompareModal from "@/components/CompareModal";
import Hero from "@/components/Hero";
import Marquee from "@/components/Marquee";
import Results, { type SortMode, type ViewMode } from "@/components/Results";
import {
  CategoryBento,
  ClosingCta,
  Faq,
  HowItWorks,
  RepeatFavourites,
  StatsCards,
  WhyCards,
} from "@/components/Sections";
import Shortcuts from "@/components/Shortcuts";
import StickySearch from "@/components/StickySearch";
import { LockedError, searchProducts } from "@/lib/client-api";
import type { SearchResponse } from "@/lib/types";

const RECENT_KEY = "bp:recent-searches";
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export default function HomePage() {
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>("price");
  const [view, setView] = useState<ViewMode>("groups");
  const [compareOpen, setCompareOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setError(null);
    setRecent((prev) => {
      const next = [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* private mode etc. — recents are a nicety, never load-bearing */
      }
      return next;
    });
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

  return (
    <>
      <StickySearch loading={loading} onSearch={runSearch} />
      <Hero loading={loading} onSearch={runSearch} />
      <Shortcuts recent={recent} onSearch={runSearch} />
      <Marquee />

      <div id="results-anchor" ref={resultsRef} style={{ scrollMarginTop: 84 }}>
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
      <StatsCards />
      <HowItWorks />
      <RepeatFavourites onSearch={runSearch} />
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
