/**
 * Client-side memory of provider quota exhaustion.
 *
 * Why this exists: the server tracks exhaustion in module-level memory
 * (see provider-health.ts), which on serverless hosts is per warm
 * instance. The instance that serves /api/status usually never saw
 * the 429 that the search instance observed, so the header kept
 * saying "SEARCHAPI.IO CONNECTED" and the homepage "4 LIVE PRICE
 * SOURCES" while only 3 providers returned data (live Nov 2026).
 * There is no shared server store to fix that in, so the browser
 * remembers what its own searches observed: a quota error marks the
 * provider exhausted here, a successful call clears the mark. The
 * mark expires after the same 6h probe window the server uses, so a
 * quota reset is picked up by the next search's re-probe.
 *
 * First visit before any search still shows the server's view — a
 * fresh browser cannot know a quota is gone until a search observes
 * it. After one search, the header, the stats and Settings all agree
 * with reality.
 */
import { isQuotaExhaustionError } from "./provider-health";
import type { ProviderError, ProviderId, StatusResponse } from "./types";
import { PROVIDER_IDS } from "./types";

const STORAGE_KEY = "bp:provider-quota-exhausted";
const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours, matches the server

export const PROVIDER_HEALTH_CHANGED_EVENT = "bp:providers-changed";

type Marks = Partial<Record<ProviderId, number>>;

function readMarks(): Marks {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Marks = {};
    for (const id of PROVIDER_IDS) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === "number" && Number.isFinite(v)) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMarks(marks: Marks): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    /* private mode etc. — the marks are a nicety, never load-bearing */
  }
}

/** Providers marked exhausted by this browser, within the probe window. */
export function getExhaustedProviders(now: number = Date.now()): ProviderId[] {
  const marks = readMarks();
  return PROVIDER_IDS.filter((id) => {
    const at = marks[id];
    return typeof at === "number" && now - at < PROBE_INTERVAL_MS;
  });
}

/**
 * Record one search's provider outcomes: a quota error marks the
 * provider exhausted, a successful call clears the mark (the quota is
 * back). Dispatches PROVIDER_HEALTH_CHANGED_EVENT when anything
 * changed so the header, stats and Settings re-derive.
 */
export function recordSearchOutcome(
  providersUsed: ProviderId[],
  providerErrors: ProviderError[],
): void {
  const now = Date.now();
  const marks = readMarks();
  // Expired marks are gone: a fresh 429 re-marks, a fresh success clears.
  for (const id of PROVIDER_IDS) {
    const at = marks[id];
    if (typeof at === "number" && now - at >= PROBE_INTERVAL_MS) delete marks[id];
  }
  let changed = false;
  for (const e of providerErrors) {
    if (isQuotaExhaustionError(e.message) && marks[e.provider] === undefined) {
      marks[e.provider] = now;
      changed = true;
    }
  }
  for (const id of providersUsed) {
    if (marks[id] !== undefined) {
      delete marks[id];
      changed = true;
    }
  }
  if (!changed) return;
  writeMarks(marks);
  try {
    window.dispatchEvent(new Event(PROVIDER_HEALTH_CHANGED_EVENT));
  } catch {
    /* non-DOM environment — the marks still persist for next mount */
  }
}

/**
 * Overlay the browser's exhaustion marks onto a /api/status response:
 * a marked provider is not live, with the same note the server uses.
 * Returns the input unchanged when nothing is marked.
 */
export function applyExhaustionMarks(status: StatusResponse): StatusResponse {
  const exhausted = getExhaustedProviders();
  if (exhausted.length === 0) return status;
  const providers = { ...status.providers };
  for (const id of exhausted) {
    const p = providers[id];
    if (!p) continue;
    providers[id] = {
      ...p,
      live: false,
      note: "Monthly quota exhausted — searches continue on the other providers.",
    };
  }
  return { ...status, providers };
}
