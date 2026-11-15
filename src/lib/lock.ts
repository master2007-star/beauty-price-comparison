/**
 * Optional app lock.
 *
 * Enabled only when APP_PASSCODE is set. Verification is server-side with a
 * constant-time compare; sessions are HMAC-signed HttpOnly cookies; 5 wrong
 * tries from one client lock it out for 5 minutes (in-memory).
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./env";

export const LOCK_COOKIE = "bp_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function isLockEnabled(cfg: AppConfig): boolean {
  return cfg.passcode !== null && cfg.passcode.length > 0;
}

function signingSecret(cfg: AppConfig): Buffer {
  if (cfg.sessionSecret) return Buffer.from(cfg.sessionSecret, "utf-8");
  // Derive a stable secret from the passcode itself when no explicit
  // SESSION_SECRET is configured.
  return createHash("sha256").update(`beauty-price-lock:${cfg.passcode ?? ""}`, "utf-8").digest();
}

/** Constant-time passcode check (hash both sides, compare equal-length digests). */
export function verifyPasscode(input: string, cfg: AppConfig): boolean {
  if (!cfg.passcode) return false;
  const a = createHash("sha256").update(input, "utf-8").digest();
  const b = createHash("sha256").update(cfg.passcode, "utf-8").digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createSessionCookieValue(cfg: AppConfig): string {
  const payload = b64url(Buffer.from(JSON.stringify({ v: 1, t: Date.now() }), "utf-8"));
  const sig = b64url(createHmac("sha256", signingSecret(cfg)).update(payload).digest());
  return `${payload}.${sig}`;
}

export function isValidSession(cookieHeader: string | null | undefined, cfg: AppConfig): boolean {
  if (!cookieHeader) return false;
  const match = new RegExp(`(?:^|;\\s*)${LOCK_COOKIE}=([^;]+)`).exec(cookieHeader);
  const value = match?.[1];
  if (!value) return false;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return false;
  const expected = b64url(createHmac("sha256", signingSecret(cfg)).update(payload).digest());
  const a = Buffer.from(sig, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { v?: number; t?: number };
    if (data.v !== 1 || typeof data.t !== "number") return false;
    return Date.now() - data.t < SESSION_MAX_AGE_SECONDS * 1000;
  } catch {
    return false;
  }
}

export function sessionCookieHeader(cfg: AppConfig): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${LOCK_COOKIE}=${createSessionCookieValue(cfg)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookieHeader(): string {
  return `${LOCK_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

/* ------------------------- lockout tracking ------------------------- */

interface AttemptState {
  failures: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptState>();

function keyFor(clientKey: string): string {
  return clientKey || "unknown";
}

export function isLockedOut(clientKey: string): { locked: boolean; retryAfterSeconds: number } {
  const state = attempts.get(keyFor(clientKey));
  if (!state) return { locked: false, retryAfterSeconds: 0 };
  if (state.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSeconds: Math.ceil((state.lockedUntil - Date.now()) / 1000) };
  }
  if (state.lockedUntil > 0 && state.lockedUntil <= Date.now()) {
    attempts.delete(keyFor(clientKey));
  }
  return { locked: false, retryAfterSeconds: 0 };
}

export function recordFailedAttempt(clientKey: string): { attemptsLeft: number; locked: boolean } {
  const k = keyFor(clientKey);
  const state = attempts.get(k) ?? { failures: 0, lockedUntil: 0 };
  state.failures += 1;
  if (state.failures >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
    attempts.set(k, state);
    return { attemptsLeft: 0, locked: true };
  }
  attempts.set(k, state);
  return { attemptsLeft: MAX_ATTEMPTS - state.failures, locked: false };
}

export function clearAttempts(clientKey: string): void {
  attempts.delete(keyFor(clientKey));
}

export function remainingAttempts(clientKey: string): number {
  const state = attempts.get(keyFor(clientKey));
  if (!state) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - state.failures);
}

/** Client identity for lockout purposes: forwarded IP, else a fixed bucket. */
export function clientKeyFromRequest(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
