"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import RollLabel from "./RollLabel";
import { useMagnetic } from "./pointer-motion";

interface SearchFormProps {
  initialValue?: string;
  loading: boolean;
  onSearch: (query: string) => void;
  inputId: string;
  compact?: boolean;
  placeholder?: string;
}

export default function SearchForm({
  initialValue = "",
  loading,
  onSearch,
  inputId,
  compact = false,
  placeholder,
}: SearchFormProps) {
  const [value, setValue] = useState(initialValue);
  // Magnetic pull toward the cursor (fine pointer only, no reduced
  // motion). The transform lives on the button element; the roll-label
  // animates the inner label — different elements, no conflict. At rest
  // the springs sit at 0, so the button renders exactly as before.
  const magnetic = useMagnetic();

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    if (q.length >= 2) onSearch(q);
  }

  return (
    <form onSubmit={submit} role="search">
      <div className="search-row">
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
        <motion.button
          ref={magnetic.ref}
          className="btn roll-btn magnetic-btn"
          style={magnetic.style}
          onMouseMove={magnetic.onMouseMove}
          onMouseLeave={magnetic.onMouseLeave}
          type="submit"
          disabled={loading || value.trim().length < 2}
        >
          <RollLabel text={loading ? "Searching…" : "Compare prices"} />
        </motion.button>
      </div>
    </form>
  );
}
