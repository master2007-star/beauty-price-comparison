"use client";

import { useEffect, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import RollLabel from "./RollLabel";
import { useMagnetic } from "./pointer-motion";
import { smartRewrite } from "@/lib/client-api";

interface SearchFormProps {
  initialValue?: string;
  loading: boolean;
  onSearch: (query: string) => void;
  inputId: string;
  compact?: boolean;
  placeholder?: string;
  /** True when Gemini is configured (via /api/status). When false/omitted,
   *  no smart UI renders and behavior is exactly as before. */
  smartEnabled?: boolean;
  /** When set (new object identity), the input adopts this value — used
   *  by the AI chat's "See these results" to put its query in the box. */
  externalValue?: { value: string; nonce: number };
}

export default function SearchForm({
  initialValue = "",
  loading,
  onSearch,
  inputId,
  compact = false,
  placeholder,
  smartEnabled = false,
  externalValue,
}: SearchFormProps) {
  const [value, setValue] = useState(initialValue);
  const [smart, setSmart] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  /** The rewritten query of the last smart search, for the note below. */
  const [understood, setUnderstood] = useState<string | null>(null);

  useEffect(() => {
    if (externalValue) setValue(externalValue.value);
  }, [externalValue]);
  // Magnetic pull toward the cursor (fine pointer only, no reduced
  // motion). The transform lives on the button element; the roll-label
  // animates the inner label — different elements, no conflict. The mouse
  // handlers live on the search row, NOT the button: the button is
  // disabled while the box is empty, and disabled buttons fire no mouse
  // events in Chrome, so handlers on the button never run in the state
  // the user actually sees. The hook measures the button's own rect (via
  // ref) and only pulls near it, so hovering the input leaves the button
  // at rest. At rest the springs sit at 0, so the button renders exactly
  // as before.
  const magnetic = useMagnetic();

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q.length < 2) return;
    // Smart ON: ask Gemini to rewrite the query, then run the normal
    // search with the rewrite. ANY failure falls back silently to the
    // raw query — search must never break because of AI. The input keeps
    // the original text; the note below shows what the AI understood.
    if (smart && smartEnabled) {
      setRewriting(true);
      smartRewrite(q)
        .then((res) => {
          if (res.status === "ok" && res.rewrittenQuery) {
            setUnderstood(res.rewrittenQuery);
            onSearch(res.rewrittenQuery);
          } else {
            setUnderstood(null);
            onSearch(q);
          }
        })
        .catch(() => {
          setUnderstood(null);
          onSearch(q);
        })
        .finally(() => setRewriting(false));
      return;
    }
    setUnderstood(null);
    onSearch(q);
  }

  const busy = loading || rewriting;

  return (
    <form onSubmit={submit} role="search">
      <div className="search-row" onMouseMove={magnetic.onMouseMove} onMouseLeave={magnetic.onMouseLeave}>
        <input
          id={inputId}
          className="search-input"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? (compact ? "Search a product…" : "Try “Vitamin C serum”, “sunscreen SPF 50”…")}
          aria-label="Search beauty products"
          autoComplete="off"
          maxLength={120}
        />
        {smartEnabled ? (
          <button
            type="button"
            className={`smart-chip${smart ? " is-on" : ""}`}
            onClick={() => setSmart((s) => !s)}
            aria-pressed={smart}
            title="Let AI understand natural language, like “a cheap vitamin C serum”"
          >
            <span aria-hidden="true">✦</span>
            <span className="smart-chip-label">Smart</span>
          </button>
        ) : null}
        <motion.button
          ref={magnetic.ref}
          className="btn roll-btn magnetic-btn"
          style={magnetic.style}
          type="submit"
          disabled={busy || value.trim().length < 2}
        >
          <RollLabel text={rewriting ? "Thinking…" : loading ? "Searching…" : "Compare prices"} />
        </motion.button>
      </div>
      {understood ? (
        <p className="smart-note" role="status">
          AI understood: “{understood}”
        </p>
      ) : null}
    </form>
  );
}
