"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { PHOTOS } from "./photos";
import SearchForm from "./SearchForm";

interface HeroProps {
  loading: boolean;
  onSearch: (query: string) => void;
  /** True when Gemini is configured — shows the Smart toggle in the search pill. */
  smartEnabled?: boolean;
  /** External value sync for the hero search box (AI chat handoff). */
  searchBoxSync?: { value: string; nonce: number };
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
 * Gentle infinite float for the hero glass pills/cards. A wrapper element
 * on purpose: the float (outer) composes with the mount slide-in (inner)
 * through nesting, so neither animation writes the other's transform.
 * Under prefers-reduced-motion it renders a plain div — no motion at all.
 * At rest (and before the first float cycle) y is 0, so the layout is
 * identical to the un-wrapped render.
 */
function Float({
  children,
  delay = 0,
  duration = 6,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <div>{children}</div>;
  }
  return (
    <motion.div
      animate={{ y: [0, -4, 0] }}
      transition={{ duration, repeat: Infinity, ease: "easeInOut", delay }}
    >
      {children}
    </motion.div>
  );
}

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
 * fully visible from first paint. The photo also drifts on a slow Ken
 * Burns scale (a motion value, so it composes with the parallax y on the
 * same element), the glass pills/cards float gently (wrapper elements, so
 * the float never fights the mount slide-in), and the glass cards get a
 * shine sweep on hover (a decorative band parked out of view at rest).
 */
export default function Hero({ loading, onSearch, smartEnabled = false, searchBoxSync }: HeroProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const photoY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 70]);

  // Slow Ken Burns drift: scale 1.15 → 1.22 over 20s, mirroring forever.
  // A motion value in the same style object as the parallax y, so framer
  // composes both into one transform. Under reduced motion it stays at
  // the resting 1.15, exactly as before.
  const kbScale = useMotionValue(1.15);
  useEffect(() => {
    if (reduceMotion) {
      kbScale.set(1.15);
      return;
    }
    const controls = animate(kbScale, [1.15, 1.22], {
      duration: 20,
      repeat: Infinity,
      repeatType: "mirror",
      ease: "easeInOut",
    });
    return () => controls.stop();
  }, [kbScale, reduceMotion]);

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
              style={{ y: photoY, scale: kbScale }}
              fetchPriority="high"
              decoding="async"
            />
            <div className="hero-shade" />
          </div>

          <div className="hero-inner">
            <div className="hero-toprow">
              <Float delay={0} duration={6}>
                <motion.span
                  className="hero-livepill"
                  initial={reduceMotion ? false : { y: -14 }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.15, type: "spring", stiffness: 120, damping: 20 }}
                >
                  <span className="live-dot" aria-hidden="true" />
                  LIVE PRICES · FETCHED FRESH ON EVERY SEARCH
                </motion.span>
              </Float>
              <div className="hero-quick">
                {QUICK.map((q, i) => (
                  <Float key={q.label} delay={0.4 + 0.4 * i} duration={5.5 + 0.5 * (i % 2)}>
                    <motion.button
                      type="button"
                      className="hero-quickpill"
                      initial={reduceMotion ? false : { y: -14 }}
                      animate={{ y: 0 }}
                      transition={{ delay: 0.22 + 0.06 * i, type: "spring", stiffness: 120, damping: 20 }}
                      onClick={() => onSearch(q.query)}
                    >
                      {q.label} ↗
                    </motion.button>
                  </Float>
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
                <Float delay={0.3} duration={6.5}>
                  <motion.div
                    className="hero-glass"
                    initial={reduceMotion ? false : { y: 24 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.7, type: "spring", stiffness: 90, damping: 18 }}
                  >
                    <span className="glass-shine" aria-hidden="true" />
                    <span className="hero-glass-title">18 stores tracked</span>
                    <span className="hero-glass-sub">checked in a single search</span>
                  </motion.div>
                </Float>
                <Float delay={0.9} duration={5.8}>
                  <motion.div
                    className="hero-glass"
                    initial={reduceMotion ? false : { y: 24 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.82, type: "spring", stiffness: 90, damping: 18 }}
                  >
                    <span className="glass-shine" aria-hidden="true" />
                    <span className="hero-glass-title">Direct links</span>
                    <span className="hero-glass-sub">straight to the store&rsquo;s own product page</span>
                  </motion.div>
                </Float>
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
              smartEnabled={smartEnabled}
              externalValue={searchBoxSync}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
