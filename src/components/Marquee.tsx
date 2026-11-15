"use client";

interface MarqueeProps {
  /** Store names seen in the latest results; falls back to honest generic copy. */
  stores: string[];
}

const FALLBACK = [
  "Live Google Shopping prices",
  "No sign-up needed",
  "Every store, one search",
  "Prices checked on every search",
  "No invented prices, ever",
  "Same size, same variant",
];

export default function Marquee({ stores }: MarqueeProps) {
  const items = stores.length > 0 ? stores : FALLBACK;
  const row = (ariaHidden: boolean) => (
    <div className="marquee-item" aria-hidden={ariaHidden}>
      {items.map((item, i) => (
        <span key={`${item}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 28 }}>
          {item}
          <span className="dot">✦</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="marquee" aria-label={stores.length > 0 ? "Stores in the latest results" : "About this app"}>
      <div className="marquee-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
