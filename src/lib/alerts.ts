/**
 * Price alert pure business logic and validation.
 */

export interface TrackInput {
  product_key: string;
  email: string;
  target_price: number;
  title?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates track request inputs.
 * Returns null if valid, or a user-friendly error string if invalid.
 */
export function validateTrackInput(input: unknown): { error?: string; data?: TrackInput } {
  if (typeof input !== "object" || input === null) {
    return { error: "Invalid payload: expected a JSON object." };
  }

  const obj = input as Record<string, unknown>;

  const product_key = typeof obj.product_key === "string" ? obj.product_key.trim() : "";
  if (!product_key) {
    return { error: "Product identifier (product_key) is required." };
  }

  const rawEmail = typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  if (!rawEmail || !EMAIL_RE.test(rawEmail) || rawEmail.length > 254) {
    return { error: "Please provide a valid email address." };
  }

  const rawTarget = typeof obj.target_price === "number" ? obj.target_price : Number(obj.target_price);
  if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
    return { error: "Target price must be a positive number." };
  }

  const title = typeof obj.title === "string" ? obj.title.trim() : undefined;

  return {
    data: {
      product_key,
      email: rawEmail,
      target_price: Math.round(rawTarget * 100) / 100,
      title,
    },
  };
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Pure function determining whether an alert should be sent:
 *  1. Current lowest price must be at or below the user's target price.
 *  2. No alert must have been sent within the last 24 hours.
 */
export function shouldSendAlert(
  lowestPrice: number,
  targetPrice: number,
  lastAlertAt?: Date | string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(lowestPrice) || lowestPrice <= 0) return false;
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return false;

  // Price must drop to or below target
  if (lowestPrice > targetPrice) {
    return false;
  }

  // Check 24-hour rate limit
  if (lastAlertAt) {
    const alertTime = lastAlertAt instanceof Date ? lastAlertAt.getTime() : new Date(lastAlertAt).getTime();
    if (!isNaN(alertTime) && nowMs - alertTime < TWENTY_FOUR_HOURS_MS) {
      return false;
    }
  }

  return true;
}

/**
 * Validates the Authorization header for cron requests.
 * Matches `Bearer <CRON_SECRET>`.
 */
export function isCronAuthorized(
  authHeader: string | null | undefined,
  cronSecret: string | null | undefined,
): boolean {
  if (!cronSecret || cronSecret.trim().length === 0) return false;
  if (!authHeader || authHeader.trim().length === 0) return false;

  const expected = `Bearer ${cronSecret.trim()}`;
  return authHeader.trim() === expected;
}
