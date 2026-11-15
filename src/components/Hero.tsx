"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { PHOTOS } from "./photos";
import SearchForm from "./SearchForm";

interface HeroProps {
  loading: boolean;
  onSearch: (query: string) => void;
}

const HEADLINE: string[][] = [
  ["The", "same", "serum."],
  ["Every", "store.", "One"],
  ["honest", "price."],
];

const QUICK: Array<{ label: string; query: string }> = [
  { label: "Skincare", query: "Skincare" },
  { label: "Serums", query: "Serums" },
  { label: "SPF", query: "Sunscreen SPF 50" },
  { label: "Lip care", query: "Lip care" },
];

/**
 * Full-width photo hero, 760px, matching the artifact: glass pills on top,
 * huge white serif headline bottom-left, two glass cards on the right, and
 * the search bar straddling the bottom edge. All motion is transform-only:
 * the headline staggers in with small y-rises on mount, the glass pills and
 * glass cards slide in on mount, and the photo drifts on scroll parallax.
 * Nothing ever gates visibility on opacity, and the headline lines are NOT
 * overflow-masked: a masked rise (words starting below the mask) leaves the
 * headline clipped mid-line in the server HTML and until hydration +
 * animation finish, so the words rise from a small offset instead and are
 * fully visible from first paint.
 */
export default function Hero({ loading, onSearch }: HeroProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const photoY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 70]);

  const word = {
    hidden: { y: 20 },
    show: (i: number) => ({
      y: 0,
      transition: { delay: 0.08 * i + 0.1, type: "spring" as const, stiffness: 90, damping: 18 },
    }),
  };

  const line = (words: string[], offset: number) => (
    <span style={{ display: "block" }}>
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          custom={offset + i}
          variants={word}
          initial={reduceMotion ? "show" : "hidden"}
          animate="show"
          style={{ display: "inline-block", marginRight: "0.28em" }}
        >
          {w}
        </motion.span>
      ))}
    </span>
  );

  return (
    <section className="hero" aria-label="Introduction">
      <div className="wrap">
        <div className="hero-card" ref={ref}>
          <div className="hero-media" aria-hidden="true">
            <motion.img
              src={PHOTOS.hero}
              alt=""
              style={{ y: photoY, scale: 1.15 }}
              fetchPriority="high"
              decoding="async"
            />
            <div className="hero-shade" />
          </div>

          <div className="hero-inner">
            <div className="hero-toprow">
              <motion.span
                className="hero-livepill"
                initial={reduceMotion ? false : { y: -14 }}
                animate={{ y: 0 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 120, damping: 20 }}
              >
                <span className="live-dot" aria-hidden="true" />
                LIVE PRICES · FETCHED FRESH ON EVERY SEARCH
              </motion.span>
              <div className="hero-quick">
                {QUICK.map((q, i) => (
                  <motion.button
                    key={q.label}
                    type="button"
                    className="hero-quickpill"
                    initial={reduceMotion ? false : { y: -14 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.22 + 0.06 * i, type: "spring", stiffness: 120, damping: 20 }}
                    onClick={() => onSearch(q.query)}
                  >
                    {q.label} ↗
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="hero-bottom">
              <div className="hero-copy">
                <span className="hero-kicker">BEAUTY PRICE COMPARISON</span>
                <h1 className="display">
                  {line(HEADLINE[0], 0)}
                  {line(HEADLINE[1], 3)}
                  {line(HEADLINE[2], 6)}
                </h1>
                <motion.p
                  className="hero-sub"
                  initial={reduceMotion ? false : { y: 18 }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.55, type: "spring", stiffness: 80, damping: 18 }}
                >
                  Search a product once — live prices from every store that sells it, ranked lowest first, with a
                  straight path to the exact product page.
                </motion.p>
              </div>

              <div className="hero-glasscards">
                <motion.div
                  className="hero-glass"
                  initial={reduceMotion ? false : { y: 24 }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.7, type: "spring", stiffness: 90, damping: 18 }}
                >
                  <span className="hero-glass-title">18 stores tracked</span>
                  <span className="hero-glass-sub">checked in a single search</span>
                </motion.div>
                <motion.div
                  className="hero-glass"
                  initial={reduceMotion ? false : { y: 24 }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.82, type: "spring", stiffness: 90, damping: 18 }}
                >
                  <span className="hero-glass-title">Direct links</span>
                  <span className="hero-glass-sub">straight to the store&rsquo;s own product page</span>
                </motion.div>
              </div>
            </div>
          </div>

          {/* Plain div on purpose: the straddle positioning lives in CSS
              (translate -50%/+50%), and a motion transform would override it. */}
          <div className="hero-search">
            <SearchForm
              loading={loading}
              onSearch={onSearch}
              inputId="hero-search"
              placeholder={'Try "The Ordinary Niacinamide 10%"…'}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
