"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PHOTOS } from "./photos";
import { useMagnetic, useTilt } from "./pointer-motion";
import RollLabel from "./RollLabel";
import { fetchStatus } from "@/lib/client-api";
import { PROVIDER_IDS } from "@/lib/types";

/**
 * Below-fold entrances are TRANSFORM-ONLY (y). Opacity is never animated
 * on scroll-into-view, so no control can ever sit invisible.
 */
const rise = {
  hidden: { y: 28 },
  show: (i: number = 0) => ({
    y: 0,
    transition: { delay: 0.07 * i, type: "spring" as const, stiffness: 90, damping: 18 },
  }),
};

function SectionHead({ eyebrow, title, blurb }: { eyebrow: string; title: ReactNode; blurb?: string }) {
  return (
    <div className="section-head">
      <span className="eyebrow eyebrow-rule">{eyebrow}</span>
      <h2 className="display">{title}</h2>
      {blurb ? <p className="section-blurb">{blurb}</p> : null}
    </div>
  );
}

/* ------------------------------ categories ------------------------------ */

type BentoKind = "photo" | "lime" | "olive" | "cream" | "sage";

const TILES: Array<{
  kind: BentoKind;
  photo?: string;
  title: string;
  sub: string;
  query: string;
  wide?: boolean;
}> = [
  {
    kind: "photo",
    photo: PHOTOS.serumBottles,
    title: "Vitamin C & brightening",
    sub: "The morning layer everyone overpays for",
    query: "Vitamin C serum",
    wide: true,
  },
  { kind: "lime", title: "Sunscreen & SPF", sub: "Daily wear, no white cast", query: "Sunscreen SPF 50" },
  {
    kind: "photo",
    photo: PHOTOS.creamTile,
    title: "Barrier & ceramide care",
    sub: "Repairs the skin barrier overnight",
    query: "Ceramide moisturiser",
  },
  {
    kind: "olive",
    title: "Serums & actives",
    sub: "Niacinamide, retinol, the targeted stuff",
    query: "Niacinamide serum",
  },
  { kind: "cream", title: "Lip care", sub: "Sleeping masks and overnight repair", query: "Lip sleeping mask" },
  // DRAFTED — the 6th tile was cut off in the screenshots (only a pale sage
  // tile edge was visible). Title/subtitle/query are the parent's draft.
  { kind: "sage", title: "Cleansers", sub: "Gentle daily cleansing", query: "Gentle face cleanser", wide: true },
];

export function CategoryBento({ onSearch }: { onSearch: (query: string) => void }) {
  return (
    <section className="section" aria-label="Browse the shelf">
      <div className="wrap">
        <SectionHead
          eyebrow="Browse the shelf"
          title={
            <>
              Start from a ritual,
              <br />
              not a search box.
            </>
          }
          blurb="Six shelves people restock again and again. Tap one and the full comparison — every store, lowest first — runs itself."
        />
        <div className="bento">
          {TILES.map((tile, i) => (
            <BentoTile key={tile.title} tile={tile} index={i} onSearch={onSearch} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One bento tile. 3D tilt (rotateX/rotateY motion values + perspective)
 * lives in the same style object as the entrance variants and the
 * whileHover lift, so framer composes one transform — the tilt never
 * fights the rise or the lift. The photo zoom is CSS on the inner <img>,
 * a different element. Tilt is fine-pointer only and off under
 * prefers-reduced-motion (see useTilt); at rest the springs sit at 0.
 */
function BentoTile({
  tile,
  index,
  onSearch,
}: {
  tile: (typeof TILES)[number];
  index: number;
  onSearch: (query: string) => void;
}) {
  const tilt = useTilt();
  return (
    <motion.button
      type="button"
      className={`bento-tile bento-${tile.kind}${tile.wide ? " bento-wide" : ""}`}
      custom={index}
      variants={rise}
      initial="hidden"
      whileInView="show"
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.99 }}
      viewport={{ once: true, margin: "-40px" }}
      style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformPerspective: 900 }}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      onClick={() => onSearch(tile.query)}
    >
      {tile.photo ? (
        <>
          <img className="bento-photo" src={tile.photo} alt="" loading="lazy" decoding="async" />
          <span className="bento-shade" aria-hidden="true" />
        </>
      ) : null}
      <span className="bento-text">
        <span className="bento-title">{tile.title}</span>
        <span className="bento-sub">{tile.sub}</span>
      </span>
      <span className="bento-arrow" aria-hidden="true">
        →
      </span>
    </motion.button>
  );
}

/* ------------------------------ stat cards ------------------------------ */

/**
 * Stat numbers render directly — no count-up animation. The old
 * animation started at 0 and only counted up when the cards scrolled
 * into view, so on first load the page read "0 LIVE PRICE SOURCES /
 * 0 MAJOR STORES" while searches worked fine.
 */
export function StatsCards() {
  const reduceMotion = useReducedMotion();
  // Live price sources come from /api/status: only providers whose
  // key is configured AND whose monthly quota is not exhausted count.
  // Until the status loads, the number shows "–", never 0.
  const [liveSources, setLiveSources] = useState<number | null>(null);
  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setLiveSources(PROVIDER_IDS.filter((id) => s.providers[id]?.live).length);
      })
      .catch(() => setLiveSources(null));
  }, []);

  const stats = [
    {
      value: liveSources === null ? "–" : String(liveSources),
      label: "LIVE PRICE SOURCES",
      body: "SerpApi, SearchApi.io, Serper and Searlo — every live key is queried on every search and merged.",
    },
    {
      value: "18",
      label: "MAJOR STORES TRACKED",
      body: "Nykaa, Amazon.in, Purplle, Myntra, Flipkart, Tira and more — the results header shows which ones actually listed your product.",
    },
    {
      value: "100%",
      label: "VARIANT-MATCHED GROUPS",
      body: "Brand, product name and variant must agree before two listings share a card — a saving is never faked across different products.",
    },
  ];

  return (
    <section className="section section-tight" aria-label="About this comparison">
      <div className="wrap">
        <div className="stat-cards">
          {stats.map((stat, i) => (
            <motion.article
              key={stat.label}
              className="stat-card"
              custom={i}
              variants={rise}
              initial="hidden"
              whileInView="show"
              whileHover={reduceMotion ? undefined : { y: -4 }}
              viewport={{ once: true, margin: "-40px" }}
            >
              <div className="stat-number">{stat.value}</div>
              <div className="stat-tag">{stat.label}</div>
              <p>{stat.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ how it works ------------------------------ */

const STEPS = [
  {
    num: "01",
    title: "Name the product",
    body: "Brand and product, the way it is printed on the bottle. Specific searches match the exact variant far better than vague ones.",
  },
  {
    num: "02",
    title: "Same product, stores side by side",
    body: "Your connected keys query Google Shopping live through SerpApi, SearchApi.io, Serper and Searlo. Listings for the same product are grouped into one card — lowest price up front, the priciest struck through, the saving spelled out. Tap Compare on any product and a fresh search on that exact product hunts down every other store selling it.",
  },
  // DRAFTED — step 03 was not visible in the screenshots. Wording is the
  // parent's draft, from the app's documented direct-link behaviour.
  {
    num: "03",
    title: "Straight to the shelf",
    body: "Go to Store opens the store's own product page for that exact item — the direct link is looked up per product, with the Google Shopping page only as an honest fallback.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" aria-label="How it works">
      <div className="wrap how-grid">
        <motion.div
          className="how-photo"
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          <img src={PHOTOS.creamTall} alt="Woman applying face cream to her cheek" loading="lazy" decoding="async" />
        </motion.div>
        <div>
          <SectionHead
            eyebrow="How it works"
            title={
              <>
                Three steps between you
                <br />
                and the right price
              </>
            }
          />
          <ol className="how-steps">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.num}
                custom={i}
                variants={rise}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-40px" }}
              >
                <span className="how-num" aria-hidden="true">
                  {step.num}
                </span>
                <span>
                  <span className="how-step-title">{step.title}</span>
                  <span className="how-step-body">{step.body}</span>
                </span>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* --------------------------- repeat favourites --------------------------- */

const FAVOURITES = [
  { title: "Vitamin C serums", sub: "Brightening, morning layer", query: "Vitamin C serums" },
  { title: "SPF 50 sunscreens", sub: "No white cast, daily wear", query: "SPF 50 sunscreens" },
  { title: "Ceramide moisturisers", sub: "Barrier repair, night layer", query: "Ceramide moisturisers" },
  { title: "Retinol night creams", sub: "Slow, steady resurfacing", query: "Retinol night creams" },
  { title: "Lip sleeping masks", sub: "Overnight repair", query: "Lip sleeping masks" },
];

export function RepeatFavourites({ onSearch }: { onSearch: (query: string) => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <section className="section" aria-label="Repeat favourites">
      <div className="wrap fav-grid">
        <div>
          <SectionHead
            eyebrow="Repeat favourites"
            title="Start with the shelf staples"
            blurb="The searches people run again and again. Tap one and the comparison runs itself."
          />
          <div className="fav-rows">
            {FAVOURITES.map((fav, i) => (
              <motion.button
                key={fav.title}
                type="button"
                className="fav-row"
                custom={i}
                variants={rise}
                initial="hidden"
                whileInView="show"
                whileHover={reduceMotion ? undefined : { y: -2 }}
                viewport={{ once: true, margin: "-40px" }}
                onClick={() => onSearch(fav.query)}
              >
                <span className="fav-text">
                  <span className="fav-title">{fav.title}</span>
                  <span className="fav-sub">{fav.sub}</span>
                </span>
                <span className="fav-arrow" aria-hidden="true">
                  ↗
                </span>
              </motion.button>
            ))}
          </div>
        </div>
        <motion.figure
          className="fav-photo"
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          {/* Clipping frame for the hover zoom: the scaled img must not
              paint over the caption. Block div, same box as the img, so
              the resting layout is unchanged. */}
          <div className="fav-photo-frame">
            <img
              src={PHOTOS.favourites}
              alt="Amber skincare bottles arranged with stone blocks"
              loading="lazy"
              decoding="async"
            />
          </div>
          <figcaption>
            SKINCARE · MAKEUP · HAIR · FRAGRANCE — IF A STORE SELLS IT THROUGH GOOGLE SHOPPING, IT CAN BE COMPARED
            HERE.
          </figcaption>
        </motion.figure>
      </div>
    </section>
  );
}

/* ------------------------------ why cards ------------------------------ */

const WHY = [
  {
    icon: "₹",
    title: "Same product, real spread",
    body: "One search groups every store's listing for the exact same variant into one card — lowest price up front, priciest struck through, saving spelled out in rupees and percent.",
  },
  {
    icon: "✓",
    title: "Matched, not guessed",
    body: "Brand, finish, size and pack must all agree before listings share a card. When the matcher isn't sure, it splits — it would rather show one store honestly than invent a saving.",
  },
  {
    icon: "↗",
    title: "Straight to the shelf",
    body: "Go to Store lands on the store's own product page for that item — the direct link is looked up per product, with the Google Shopping page only as an honest fallback.",
  },
];

export function WhyCards() {
  return (
    <section className="section why-section" aria-label="Why compare here">
      <div className="wrap">
        <SectionHead
          eyebrow="Why compare at all"
          title={
            <>
              The first price you see is
              <br />
              rarely the right one
            </>
          }
          blurb="The same bottle sits on a dozen shelves at a dozen prices. This app exists to put those shelves side by side — carefully, so the comparison is always apples to apples."
        />
        <div className="why-grid">
          {WHY.map((card, i) => (
            <WhyCard key={card.title} card={card} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One why-card. Same tilt setup as BentoTile: rotateX/rotateY motion
 * values in the style object compose with the entrance variants and the
 * whileHover lift in framer's single transform pipeline.
 */
function WhyCard({ card, index }: { card: (typeof WHY)[number]; index: number }) {
  const tilt = useTilt();
  return (
    <motion.article
      className="why-card"
      custom={index}
      variants={rise}
      initial="hidden"
      whileInView="show"
      whileHover={{ y: -4 }}
      viewport={{ once: true, margin: "-40px" }}
      style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformPerspective: 900 }}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
    >
      <div className="why-icon" aria-hidden="true">
        {card.icon}
      </div>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
    </motion.article>
  );
}

/* --------------------------------- FAQ --------------------------------- */

const FAQ = [
  {
    q: "Where do these prices actually come from?",
    a: "From Google Shopping, fetched live at the moment you search through your own API keys — SerpApi, SearchApi.io, Serper or Searlo. Nothing is cached or scraped in the background, so a price here is exactly what the source returned seconds ago.",
  },
  // DRAFTED — answers 2–5 were not visible in the screenshots. Each is
  // written from the app's documented behaviour; see the build report.
  {
    q: "How do you make sure it's the same product in every store?",
    a: "Listings are grouped only when the brand, finish, size and pack count all agree — sizes are normalised first, so 16 fl oz and 473 ml count as the same size. When the matcher isn't sure, it splits the listings apart rather than risk comparing two different products.",
  },
  {
    q: "What does “Go to Store” open, exactly?",
    a: "Go to Store opens the store's own product page for that exact item whenever a direct link can be confirmed — the seller name and the exact price both have to match. When no exact match is found, the button takes you to the Google Shopping product page instead, and says so.",
  },
  {
    q: "Why can the store's price differ from what's shown here?",
    a: "Prices here are a live snapshot from the moment you searched. Stores can change a price, run a short promotion, or show a different price once delivery or an offer is applied — so the price on the store's own page can differ from the one captured here.",
  },
  {
    q: "Are my API keys safe in Settings?",
    a: "Yes. In this standalone build the keys live only in the server's environment variables — the browser never receives them, and there is nowhere on this site to store or display a full key. Settings shows only the last 4 characters of each configured key, so you can tell them apart.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();
  return (
    <section className="section" aria-label="Frequently asked questions">
      <div className="wrap">
        <SectionHead
          eyebrow="Good questions"
          title="Before you ask"
          blurb="How the prices, the matching and your keys actually work — the short, honest version."
        />
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
                    className={`faq-icon${isOpen ? " is-open" : ""}`}
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 }}
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
                      transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
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
  // Magnetic pull toward the cursor (fine pointer only, no reduced
  // motion). Transform on the button; the roll-label animates the inner
  // label — different elements, no conflict.
  const magnetic = useMagnetic();
  return (
    <section className="section" aria-label="Get started">
      <div className="wrap">
        <motion.div
          className="cta-band"
          variants={rise}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-40px" }}
        >
          <span className="cta-eyebrow">ONE SEARCH AWAY</span>
          <h2 className="display">
            Stop paying the first
            <br />
            price you see.
          </h2>
          <p>Name the product. See every store that sells it. Buy it once, at the right price.</p>
          <motion.button
            ref={magnetic.ref}
            type="button"
            className="cta-btn roll-btn magnetic-btn"
            style={magnetic.style}
            onMouseMove={magnetic.onMouseMove}
            onMouseLeave={magnetic.onMouseLeave}
            onClick={onStart}
          >
            <RollLabel text="Compare a product now ↑" />
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
