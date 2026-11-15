"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchStatus } from "@/lib/client-api";
import { PROVIDER_IDS } from "@/lib/types";

/** Status line exactly as the artifact shows it, built from /api/status. */
const STATUS_LABELS: Record<string, string> = {
  serpapi: "SERPAPI",
  searchapi: "SEARCHAPI.IO",
  serper: "SERPER",
  searlo: "SEARLO",
};

export default function TopStatus() {
  const [line, setLine] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        const on = PROVIDER_IDS.filter((id) => s.providers[id]?.configured);
        setConnected(on.length > 0);
        setLine(
          on.length > 0
            ? `${on.map((id) => STATUS_LABELS[id]).join(" + ")} CONNECTED`
            : "NO PROVIDER KEYS CONNECTED",
        );
      })
      .catch(() => setLine("PROVIDER STATUS UNAVAILABLE"));
  }, []);

  return (
    <div className="statusbar">
      <div className="wrap statusbar-inner">
        <span className="status-line">
          <span className={`status-dot${connected ? " is-on" : ""}`} aria-hidden="true" />
          {line ?? "CHECKING PROVIDERS…"}
        </span>
        <Link href="/settings" className="status-settings">
          Settings
        </Link>
      </div>
    </div>
  );
}
