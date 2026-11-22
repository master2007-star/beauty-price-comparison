"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { compareQueries } from "@/lib/client-api";
import { recordSearchOutcome } from "@/lib/provider-exhaustion";
import type { CompareResponse } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/types";

interface CompareModalProps {
  open: boolean;
  initialQueries: string[];
  onClose: () => void;
}

/**
 * Deep compare: up to 3 queries, catalog-anchored + size-strict alignment.
 * Panel enters with a spring (transform-only); the backdrop fades (it is
 * non-interactive decoration, removed from the DOM on exit).
 */
export default function CompareModal({ open, initialQueries, onClose }: CompareModalProps) {
  const [queries, setQueries] = useState<string[]>(["", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);

  useEffect(() => {
    if (open) {
      setQueries([initialQueries[0] ?? "", initialQueries[1] ?? "", initialQueries[2] ?? ""]);
      setResult(null);
      setError(null);
    }
  }, [open, initialQueries]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function run() {
    const qs = queries.map((q) => q.trim()).filter((q) => q.length >= 2);
    if (qs.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await compareQueries(qs);
      for (const r of res.results) recordSearchOutcome(r.providersUsed, r.providerErrors);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed.");
    } finally {
      setLoading(false);
    }
  }

  const maxPrice = result
    ? Math.max(0, ...result.results.flatMap((r) => r.groups.map((g) => g.lowestPrice)))
    : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Deep compare"
            initial={{ y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 32, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Deep compare</span>
                <h2 className="display">Up to 3 searches, side by side</h2>
                <p className="muted small" style={{ margin: "8px 0 0" }}>
                  Products are matched across queries by catalog id and exact variant (size, pack, SPF). Nothing is
                  merged on a guess.
                </p>
              </div>
              <button type="button" className="modal-close" onClick={onClose} aria-label="Close compare">×</button>
            </div>

            <div className="compare-inputs">
              {queries.map((q, i) => (
                <input
                  key={i}
                  value={q}
                  onChange={(e) => setQueries((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  placeholder={i === 0 ? "First product" : `Product ${i + 1} (optional)`}
                  aria-label={`Compare query ${i + 1}`}
                  maxLength={120}
                />
              ))}
            </div>
            <button type="button" className="btn btn-terra" onClick={run} disabled={loading}>
              {loading ? "Comparing…" : "Run deep compare"}
            </button>

            {error ? (
              <div className="notice notice-error" role="alert">
                <p>{error}</p>
              </div>
            ) : null}

            {result ? (
              <div style={{ marginTop: 24 }}>
                {result.aligned.length > 0 ? (
                  <>
                    <h3 className="display" style={{ fontSize: "1.2rem", margin: "0 0 10px" }}>
                      Same product found in multiple searches
                    </h3>
                    <table className="aligned-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          {result.queries.map((q) => (
                            <th key={q}>“{q}”</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.aligned.map((m) => (
                          <tr key={m.key}>
                            <td>{m.title}</td>
                            {result.queries.map((q) => {
                              const cell = m.perQuery.find((p) => p.query === q);
                              return <td key={q}>{cell ? `${cell.lowestLabel} · ${cell.storeCount} stores` : "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <p className="muted">
                    No product appeared in more than one search with the same variant. Per-search best prices are
                    below.
                  </p>
                )}

                {result.results.map((r) => (
                  <div key={r.query} style={{ marginTop: 22 }}>
                    <h3 className="display" style={{ fontSize: "1.2rem", margin: "0 0 6px" }}>“{r.query}”</h3>
                    <p className="small muted" style={{ margin: "0 0 8px" }}>
                      {r.groups.length} {r.groups.length === 1 ? "product" : "products"} · via{" "}
                      {r.providersUsed.map((p) => PROVIDER_LABELS[p]).join(", ") || "no providers"}
                      {r.providerErrors.map((e) => ` · ${PROVIDER_LABELS[e.provider]} failed`).join("")}
                    </p>
                    {r.groups.slice(0, 6).map((g) => (
                      <div className="price-bar-row" key={g.id}>
                        <span style={{ fontWeight: 600 }}>{g.title}</span>
                        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{g.lowestLabel}</span>
                        <div className="price-bar-track">
                          <motion.div
                            className="price-bar-fill"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: maxPrice > 0 ? g.lowestPrice / maxPrice : 0 }}
                            transition={{ type: "spring", stiffness: 80, damping: 20 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
