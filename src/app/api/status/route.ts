import { NextResponse } from "next/server";
import { getConfig, last4 } from "@/lib/env";
import { isGeminiConfigured } from "@/lib/gemini";
import { providerHealthSnapshot } from "@/lib/provider-health";
import type { ProviderId, StatusResponse } from "@/lib/types";
import { PROVIDER_IDS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cfg = getConfig();
  const health = providerHealthSnapshot();
  const providers = {} as StatusResponse["providers"];
  for (const id of PROVIDER_IDS satisfies ProviderId[]) {
    const exhausted = health[id].quotaExhausted;
    providers[id] = {
      configured: Boolean(cfg.keys[id]),
      last4: last4(cfg.keys[id]),
      // Live means key configured AND not known-quota-exhausted. A
      // provider is only marked exhausted after a real search
      // observed its monthly quota gone; until then it is assumed
      // live, so a fresh deploy never claims a working provider
      // is dead.
      live: Boolean(cfg.keys[id]) && !exhausted,
      note: health[id].note,
    };
  }
  const body: StatusResponse = {
    region: cfg.region,
    language: cfg.language,
    passcodeSet: cfg.passcode !== null,
    geminiConfigured: isGeminiConfigured(),
    providers,
  };
  return NextResponse.json(body);
}
