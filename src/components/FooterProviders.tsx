"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchStatus } from "@/lib/client-api";
import {
  applyExhaustionMarks,
  PROVIDER_HEALTH_CHANGED_EVENT,
} from "@/lib/provider-exhaustion";
import { PROVIDER_IDS } from "@/lib/types";

/** Footer provider line, built from /api/status — same source as the header. */
const MONO_LABELS: Record<string, string> = {
  serpapi: "SERPAPI",
  searchapi: "SEARCHAPI.IO",
  serper: "SERPER",
  searlo: "SEARLO",
};

/**
 * The footer names the providers that are actually live. It derives
 * from the same /api/status view + browser exhaustion marks as the
 * header, so a quota-exhausted provider drops out of the live list
 * and is named as exhausted instead — and comes back automatically
 * when its quota resets. Before the status loads, the full provider
 * list renders: a fresh browser cannot know a quota is gone until a
 * search observes it (same honest limit as the header).
 */
export default function FooterProviders() {
  const [line, setLine] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchStatus()
      .then((raw) => {
        const s = applyExhaustionMarks(raw);
        const live = PROVIDER_IDS.filter((id) => s.providers[id]?.live);
        const exhausted = PROVIDER_IDS.filter(
          (id) => s.providers[id]?.configured && !s.providers[id]?.live,
        );
        setLine(
          live.length > 0
            ? `${live.map((id) => MONO_LABELS[id]).join(" · ")} — VIA GOOGLE SHOPPING${
                exhausted.length > 0
                  ? ` · ${exhausted.map((id) => MONO_LABELS[id]).join(" · ")} QUOTA EXHAUSTED`
                  : ""
              }`
            : "VIA GOOGLE SHOPPING",
        );
      })
      .catch(() => setLine(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(PROVIDER_HEALTH_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROVIDER_HEALTH_CHANGED_EVENT, load);
  }, [load]);

  return <p className="footer-mono">{line ?? "SERPAPI · SEARCHAPI.IO · SERPER · SEARLO — VIA GOOGLE SHOPPING"}</p>;
}
