import type {
  AskRequest,
  AskResponse,
  ChatTurn,
  CompareResponse,
  RefreshPricesRequest,
  RefreshPricesResponse,
  ResolveLinksRequest,
  ResolveLinksResponse,
  SearchResponse,
  SmartSearchResponse,
  StatusResponse,
} from "@/lib/types";

export class LockedError extends Error {
  constructor() {
    super("locked");
    this.name = "LockedError";
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (data.error === "locked") {
      window.dispatchEvent(new Event("bp:locked"));
      throw new LockedError();
    }
    throw new Error(data.error ?? "Unauthorized.");
  }
  const data = (await res.json().catch(() => null)) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export function searchProducts(query: string): Promise<SearchResponse> {
  return postJson<SearchResponse>("/api/search", { query });
}

export function askAi(message: string, history: ChatTurn[]): Promise<AskResponse> {
  return postJson<AskResponse>("/api/ask", { message, history } satisfies AskRequest);
}

export function smartRewrite(query: string): Promise<SmartSearchResponse> {
  return postJson<SmartSearchResponse>("/api/smart-search", { query });
}

export function compareQueries(queries: string[]): Promise<CompareResponse> {
  return postJson<CompareResponse>("/api/compare", { queries });
}

export function resolveLinks(req: ResolveLinksRequest): Promise<ResolveLinksResponse> {
  return postJson<ResolveLinksResponse>("/api/resolve-links", req);
}

export function refreshPrices(
  req: RefreshPricesRequest,
  signal?: AbortSignal,
): Promise<RefreshPricesResponse> {
  return postJson<RefreshPricesResponse>("/api/refresh-prices", req, signal);
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`Status check failed (${res.status}).`);
  return (await res.json()) as StatusResponse;
}

export async function fetchLockStatus(): Promise<{ locked: boolean; passcodeSet: boolean }> {
  const res = await fetch("/api/lock/status");
  if (!res.ok) throw new Error("Lock check failed.");
  return (await res.json()) as { locked: boolean; passcodeSet: boolean };
}

export async function verifyPasscode(passcode: string): Promise<{ ok: boolean; error?: string; attemptsLeft?: number; retryAfterSeconds?: number }> {
  const res = await fetch("/api/lock/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    unlocked?: boolean;
    error?: string;
    attemptsLeft?: number;
    retryAfterSeconds?: number;
  };
  if (res.ok && data.unlocked) return { ok: true };
  return { ok: false, error: data.error, attemptsLeft: data.attemptsLeft, retryAfterSeconds: data.retryAfterSeconds };
}

export async function logout(): Promise<void> {
  await fetch("/api/lock/logout", { method: "POST" });
}
