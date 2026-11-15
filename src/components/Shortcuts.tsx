"use client";

interface ShortcutsProps {
  /** Recent searches from localStorage (newest first). Empty before any search. */
  recent: string[];
  onSearch: (query: string) => void;
}

const POPULAR = [
  "Vitamin C serum",
  "Sunscreen SPF 50",
  "Niacinamide serum",
  "Lip sleeping mask",
  "Gentle face cleanser",
  "Ceramide moisturiser",
];

export default function Shortcuts({ recent, onSearch }: ShortcutsProps) {
  return (
    <div className="wrap shortcuts" aria-label="Popular and recent searches">
      <div className="pop-chips">
        {POPULAR.map((chip) => (
          <button key={chip} type="button" className="pop-chip" onClick={() => onSearch(chip)}>
            {chip}
          </button>
        ))}
      </div>
      {recent.length > 0 ? (
        <div className="recent-row">
          <span className="recent-label">RECENT</span>
          <div className="recent-chips">
            {recent.map((q) => (
              <button key={q} type="button" className="recent-chip" onClick={() => onSearch(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
