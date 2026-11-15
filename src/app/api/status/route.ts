import { NextResponse } from "next/server";
import { getConfig, last4 } from "@/lib/env";
import { isGeminiConfigured } from "@/lib/gemini";
import type { ProviderId, StatusResponse } from "@/lib/types";
import { PROVIDER_IDS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cfg = getConfig();
  const providers = {} as StatusResponse["providers"];
  for (const id of PROVIDER_IDS satisfies ProviderId[]) {
    providers[id] = { configured: Boolean(cfg.keys[id]), last4: last4(cfg.keys[id]) };
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
