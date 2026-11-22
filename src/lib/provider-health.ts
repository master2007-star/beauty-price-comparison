/**
 * In-memory provider health: once a provider answers with a monthly
 * quota-exhaustion error (SearchApi.io, Nov 2026: "You have used all
 * of the searches for the month. Please upgrade your plan..."), the
 * site stops calling it and stops presenting it as live — until a
 * re-probe (at most one call every PROBE_INTERVAL) proves the quota
 * is back, or a successful call clears the mark. No spend, no new
 * infrastructure: module-level state on the server instance.
 *
 * On serverless hosts the cache is per warm instance and may be cold
 * after a recycle; a cold cache simply re-probes with one real call,
 * which is the correct behaviour anyway. A provider is only ever
 * marked exhausted after a real search observed the quota error —
 * never from config alone — so a fresh deploy never claims a working
 * provider is dead.
 */
import type { ProviderId } from "./types";
import { PROVIDER_IDS } from "./types";

const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface ProviderHealth {
  quotaExhausted: boolean;
  /** When the exhaustion was last observed (a failed call). */
  lastCheckedAt: number;
  /** The provider's own error text, truncated. */
  lastError: string | null;
}

const health = new Map<ProviderId, ProviderHealth>();

/** True when the provider's error text says the monthly quota is gone. */
export function isQuotaExhaustionError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /used all of the searches|monthly limit|upgrade your plan|quota exceeded|monthly quota/i.test(message);
}

/**
 * Record one provider call's outcome. A quota-exhaustion error marks
 * the provider exhausted; a successful call clears the mark (the
 * quota is back). Any other error leaves the mark alone: a transient
 * failure is not a quota exhaustion.
 */
export function recordProviderResult(id: ProviderId, errorMessage: string | null): void {
  if (errorMessage && isQuotaExhaustionError(errorMessage)) {
    health.set(id, { quotaExhausted: true, lastCheckedAt: Date.now(), lastError: errorMessage.slice(0, 160) });
    return;
  }
  if (!errorMessage) {
    const prev = health.get(id);
    if (prev?.quotaExhausted) {
      health.set(id, { quotaExhausted: false, lastCheckedAt: Date.now(), lastError: null });
    }
  }
}

/**
 * True when the provider is known-quota-exhausted and not yet due a
 * re-probe. After PROBE_INTERVAL the next search calls it again —
 * that call is itself the probe, and its outcome re-marks or clears.
 */
export function isProviderQuotaExhausted(id: ProviderId): boolean {
  const h = health.get(id);
  if (!h?.quotaExhausted) return false;
  return Date.now() - h.lastCheckedAt < PROBE_INTERVAL_MS;
}

/** Sticky exhaustion state for display: true until a successful call clears it. */
export function providerHealthSnapshot(): Record<
  ProviderId,
  { quotaExhausted: boolean; note: string | null }
> {
  const out = {} as Record<ProviderId, { quotaExhausted: boolean; note: string | null }>;
  for (const id of PROVIDER_IDS) {
    const exhausted = health.get(id)?.quotaExhausted ?? false;
    out[id] = {
      quotaExhausted: exhausted,
      note: exhausted
        ? "Monthly quota exhausted — searches continue on the other providers."
        : null,
    };
  }
  return out;
}
