"use client";

import { useState, type FormEvent } from "react";

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
        <button className="btn" type="submit" disabled={loading || value.trim().length < 2}>
          {loading ? "Searching…" : "Compare prices"}
        </button>
      </div>
    </form>
  );
}
