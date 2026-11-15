import type { ProviderId } from "./types";
import { PROVIDER_IDS } from "./types";

const ENV_KEYS: Record<ProviderId, string> = {
  serpapi: "SERPAPI_KEY",
  searchapi: "SEARCHAPI_KEY",
  serper: "SERPER_KEY",
  searlo: "SEARLO_KEY",
};

export interface AppConfig {
  keys: Partial<Record<ProviderId, string>>;
  region: string;
  language: string;
  passcode: string | null;
  sessionSecret: string | null;
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read config from the environment. Keys never leave the server. */
export function getConfig(): AppConfig {
  const keys: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const v = readEnv(ENV_KEYS[id]);
    if (v) keys[id] = v;
  }
  return {
    keys,
    region: (readEnv("REGION") ?? "in").toLowerCase(),
    language: (readEnv("LANGUAGE") ?? "en").toLowerCase(),
    passcode: readEnv("APP_PASSCODE"),
    sessionSecret: readEnv("SESSION_SECRET"),
  };
}

export function configuredProviders(cfg: AppConfig): ProviderId[] {
  return PROVIDER_IDS.filter((id) => Boolean(cfg.keys[id]));
}

/** Last 4 characters only — the only part of a key ever exposed. */
export function last4(key: string | undefined): string | null {
  if (!key) return null;
  return key.length <= 4 ? "••••" : key.slice(-4);
}

export function envVarName(id: ProviderId): string {
  return ENV_KEYS[id];
}

/**
 * True when optional Google login is fully configured: the OAuth client
 * id + secret AND the session secret must all be present. Auth.js needs
 * AUTH_SECRET to sign its JWT session cookie, so a deployment with only
 * the client credentials would show a dead sign-in button — requiring
 * all three keeps the button honest. When false, no login UI is shown
 * anywhere and the app behaves exactly as before.
 */
export function isGoogleLoginConfigured(): boolean {
  return Boolean(readEnv("AUTH_GOOGLE_ID") && readEnv("AUTH_GOOGLE_SECRET") && readEnv("AUTH_SECRET"));
}
