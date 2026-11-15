"use client";

import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import SearchForm from "./SearchForm";

interface StickySearchProps {
  loading: boolean;
  onSearch: (query: string) => void;
  /** True when Gemini is configured — shows the Smart toggle in the search pill. */
  smartEnabled?: boolean;
}

/** Compact search bar that slides in (y-transform) once the hero is passed. */
export default function StickySearch({ loading, onSearch, smartEnabled = false }: StickySearchProps) {
  const [visible, setVisible] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    setVisible(y > 520);
  });

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="sticky-search"
          initial={{ y: "-110%" }}
          animate={{ y: "0%" }}
          exit={{ y: "-110%" }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <div className="wrap sticky-search-inner">
            <span className="brand-name" aria-hidden="true" style={{ fontSize: "1.05rem" }}>
              Price<span className="brand-dot">.</span>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchForm loading={loading} onSearch={onSearch} inputId="sticky-search" compact smartEnabled={smartEnabled} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
