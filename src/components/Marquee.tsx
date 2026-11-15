"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Fixed store marquee, matching the artifact. The list is duplicated for a
 * seamless loop: the track animates x from 0% to -50% (exactly one copy)
 * on a linear infinite repeat, so the restart is invisible. Transform-only;
 * under prefers-reduced-motion the track stays still and the strip scrolls
 * horizontally instead (see the reduced-motion block in globals.css).
 */
const STORES = [
  "Nykaa",
  "Amazon.in",
  "Purplle",
  "Myntra",
  "Flipkart",
  "Tira",
  "Netmeds",
  "1mg",
  "Snapdeal",
  "BigBasket",
  "Blinkit",
  "Google Shopping",
];

export default function Marquee() {
  const reduceMotion = useReducedMotion();

  const row = (ariaHidden: boolean) => (
    <div className="marquee-item" aria-hidden={ariaHidden}>
      {STORES.map((store, i) => (
        <span key={`${store}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 28 }}>
          {store}
          <span className="dot">✦</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="marquee" aria-label="Stores compared">
      <motion.div
        className="marquee-track"
        animate={reduceMotion ? { x: "0%" } : { x: ["0%", "-50%"] }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 38, ease: "linear", repeat: Infinity }
        }
      >
        {row(false)}
        {row(true)}
      </motion.div>
    </div>
  );
}
