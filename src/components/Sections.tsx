"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "framer-motion";

/**
 * Below-fold entrances are TRANSFORM-ONLY (y/scale). Opacity is never
 * animated on scroll-into-view, so no control can ever sit invisible.
 */
const rise = {
  hidden: { y: 28 },
  show: (i: number = 0) => ({
    y: 0,
    transition: { delay: 0.07 * i, type: "spring" as const, stiffness: 90, damping: 18 },
  }),
};

function SectionHead({ eyebrow, title, blurb }: { eyebrow: string; title: string; blurb?: string }) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="display">{title}</h2>
        {blurb ? <p className="muted" style={{ margin: "8px 0 0", maxWidth: "56ch" }}>{blurb}</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------ categories ------------------------------ */

const CATEGORIES = [
  { emoji: "🍊", title: "Vitamin C serums", query: "Vitamin C serum" },
  { emoji: "🧴", title: "Moisturisers", query: "moisturizer for dry skin" },
  { emoji: "☀️", title: "Sunscreens", query: "sunscreen SPF 50" },
  { emoji: "💄", title: "Lip colour", query: "lipstick" },
  { emoji: "🧖", title: "Hair wash", query: "shampoo" },
  { emoji: "✨", title: "Face cleansers", query: "face wash" },
];

export function CategoryBento({ onSearch }: { onSearch: (query: string) => void }) {
  return (
    <section className="section" aria-label="Browse categories">
      <div className="wrap">
        <SectionHead eyebrow="Browse the shelf" title="Start with a category" blurb="Every tile runs a real, live search — no canned results." />
        <div className="bento">
          {CATEGORIES.map((cat, i) => (
            <motion.button
              key={cat.query}
              type="button"
              className="bento-tile"
              custom={i}
              variants={rise}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
              onClick={() => onSearch(cat.query)}
            >
              <span className="bento-emoji" aria-hidden="true">{cat.emoji}</span>
              <span>
                <span className="bento-title" style={{ display: "block" }}>{cat.title}</span>
                <span className="bento-query">Search “{cat.query}” →</span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ stats band ------------------------------ */

export interface LiveStats {
  storeCount: number | null;
  offerCount: number | null;
  bestSavingLabel: string | null;
  bestSavingPercent: number | null;
  searched: boolean;
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, value, reduceMotion]);

  return (
    <span ref={ref}>
      {display.toLocaleString("en-IN")}
      {suffix}
    </span>
  );
}

export function StatsBand({ stats }: { stats: LiveStats }) {
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="Latest search stats">
      <div className="wrap">
        <motion.div
          className="stats-band"
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          <div>
            <div className="stat-value">
              {stats.searched && stats.storeCount !== null ? <CountUp value={stats.storeCount} /> : "–"}
            </div>
            <div className="stat-label">Stores in the last search</div>
          </div>
          <div>
            <div className="stat-value">
              {stats.searched && stats.offerCount !== null ? <CountUp value={stats.offerCount} /> : "–"}
            </div>
            <div className="stat-label">Priced offers compared</div>
          </div>
          <div>
            <div className="stat-value">
              {stats.searched && stats.bestSavingPercent !== null && stats.bestSavingPercent > 0 ? (
                <>
                  <CountUp value={stats.bestSavingPercent} suffix="%" />
                </>
              ) : (
                "–"
              )}
            </div>
            <div className="stat-label">
              Biggest saving found{stats.searched && stats.bestSavingLabel ? ` · ${stats.bestSavingLabel}` : ""}
            </div>
          </div>
        </motion.div>
        {!stats.searched ? (
          <p className="muted small" style={{ marginTop: 12 }}>
            Run a search and this band fills with live numbers from your results. Until then, no numbers are claimed.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------ why cards ------------------------------ */

const WHY = [
  {
    num: "01",
    title: "Same variant, every store",
    body: "50 ml is never mixed with 100 ml, and SPF 30 never with SPF 50. Size, pack count and finish all have to match before two listings share a group.",
  },
  {
    num: "02",
    title: "Honest links",
    body: "A direct store link is shown only when the seller name and the exact price both match. Otherwise you go via the Google Shopping page — and the app says so.",
  },
  {
    num: "03",
    title: "No invented prices",
    body: "Every price comes from a live provider response. If a provider fails, you see a warning for that provider — never a made-up number in its place.",
  },
];

export function WhyCards() {
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="Why compare here">
      <div className="wrap">
        <SectionHead eyebrow="Why compare" title="Built to be trusted" />
        <div className="why-grid">
          {WHY.map((card, i) => (
            <motion.article
              key={card.num}
              className="why-card"
              custom={i}
              variants={rise}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-40px" }}
            >
              <div className="why-num">{card.num}</div>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------- FAQ --------------------------------- */

const FAQ = [
  {
    q: "Where do the prices come from?",
    a: "Google Shopping, queried live through up to four provider APIs (SerpApi, SearchApi.io, Serper and Searlo). The provider keys live in the server's environment variables — the browser never sees them.",
  },
  {
    q: "Why do I sometimes land on a Google page instead of the store?",
    a: "A direct store link is only used when a seller listing matches both the store name and the exact price. When no exact match is found, the honest fallback is the Google Shopping product page, and the button says so.",
  },
  {
    q: "Why do two sizes of the same product show separately?",
    a: "Grouping is size-strict on purpose: a 50 ml serum and a 100 ml serum are different purchases, so they get different groups. Units are normalised first, so 16 fl oz and 473 ml do count as the same size.",
  },
  {
    q: "What happens when a provider fails?",
    a: "You see a warning naming that provider, and results from the providers that did respond still show. Failed providers never contribute placeholder data.",
  },
  {
    q: "Are my searches stored?",
    a: "No. Each search runs live against the providers and nothing about it is saved on the server.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="Frequently asked questions">
      <div className="wrap">
        <SectionHead eyebrow="Questions" title="How it works, honestly" />
        <div className="faq-list">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <div className="faq-item" key={item.q}>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <motion.span
                    className="faq-icon"
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    aria-hidden="true"
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      className="faq-a"
                      initial={{ height: 0 }}
                      animate={{ height: "auto" }}
                      exit={{ height: 0 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="faq-a-inner">{item.a}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ closing CTA ------------------------------ */

export function ClosingCta({ onStart }: { onStart: () => void }) {
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="Get started">
      <div className="wrap">
        <motion.div
          className="cta-band"
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          <div>
            <h2 className="display">Stop overpaying for the same bottle.</h2>
            <p>One search, every store, the exact variant you want — priced live.</p>
          </div>
          <button type="button" className="btn" onClick={onStart}>
            Search now ↑
          </button>
        </motion.div>
      </div>
    </section>
  );
}
