"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import SearchForm from "./SearchForm";

interface HeroProps {
  loading: boolean;
  onSearch: (query: string) => void;
}

const HEADLINE_A = ["Every", "product,"];
const HEADLINE_B = ["every", "price."];
const HEADLINE_C = ["One", "search."];

/**
 * Big animated hero. All motion is transform-only: the headline staggers in
 * with y-transforms on mount, badges float on y, and scroll parallax moves
 * layers on y. Nothing ever gates visibility on opacity.
 */
export default function Hero({ loading, onSearch }: HeroProps) {
  const ref = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const contentY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 60]);
  const badgesY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : -50]);

  const word = {
    hidden: { y: "110%" },
    show: (i: number) => ({
      y: "0%",
      transition: { delay: 0.08 * i + 0.1, type: "spring" as const, stiffness: 90, damping: 18 },
    }),
  };

  const line = (words: string[], offset: number, italic = false) => (
    <span style={{ display: "block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
      {words.map((w, i) => (
        <motion.span
          key={w}
          custom={offset + i}
          variants={word}
          initial="hidden"
          animate="show"
          style={{ display: "inline-block", marginRight: "0.28em" }}
        >
          {italic ? <em>{w}</em> : w}
        </motion.span>
      ))}
    </span>
  );

  return (
    <section className="hero" ref={ref} aria-label="Introduction">
      <div className="wrap">
        <motion.div style={{ y: contentY }}>
          <div className="hero-grid">
            <div>
              <span className="eyebrow">Live Google Shopping prices · India</span>
              <h1 className="display">
                {line(HEADLINE_A, 0)}
                {line(HEADLINE_B, 2, true)}
                {line(HEADLINE_C, 4)}
              </h1>
              <motion.p
                className="hero-sub"
                initial={{ y: 18 }}
                animate={{ y: 0 }}
                transition={{ delay: 0.55, type: "spring", stiffness: 80, damping: 18 }}
              >
                Search once and see the same product — same size, same variant — priced across every store that
                carries it. Every price is fetched live. Nothing here is invented.
              </motion.p>
            </div>
          </div>

          <motion.div
            initial={{ y: 24 }}
            animate={{ y: 0 }}
            transition={{ delay: 0.7, type: "spring", stiffness: 80, damping: 18 }}
          >
            <div className="search-card">
              <SearchForm loading={loading} onSearch={onSearch} inputId="hero-search" />
              <div className="search-hints">
                <span>Popular:</span>
                {["Vitamin C serum", "CeraVe moisturizer", "Sunscreen SPF 50", "Niacinamide serum"].map((hint) => (
                  <button key={hint} type="button" className="chip" onClick={() => onSearch(hint)}>
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>

        <motion.div className="hero-badges" style={{ y: badgesY }} aria-hidden="true">
          <motion.div
            className="glass-badge badge-a"
            animate={reduceMotion ? undefined : { y: [0, -9, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          >
            <span>✦</span>
            <span>
              <strong>Same variant,</strong> every store
            </span>
          </motion.div>
          <motion.div
            className="glass-badge badge-b"
            animate={reduceMotion ? undefined : { y: [0, 8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          >
            <span>●</span>
            <span>
              <strong>Live prices,</strong> checked on every search
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
