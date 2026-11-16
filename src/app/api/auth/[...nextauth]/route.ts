import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/auth";
import { isGoogleLoginConfigured } from "@/lib/env";

/**
 * Auth.js route handlers, gated on configuration. With no Google
 * credentials / AUTH_SECRET set (the deployed case until the owner adds
 * them in Vercel), Auth.js itself answers every /api/auth/* request with
 * a 500 "server configuration" error. That 500 is noise — no login UI is
 * shown and nothing calls this route — so answer honestly instead: 503
 * "not configured". The moment the three AUTH_* env vars are present
 * (after a redeploy), the real handlers take over unchanged.
 */
function notConfigured() {
  return NextResponse.json(
    { error: "Google login is not configured on this deployment." },
    { status: 503 },
  );
}

export async function GET(req: NextRequest) {
  if (!isGoogleLoginConfigured()) return notConfigured();
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  if (!isGoogleLoginConfigured()) return notConfigured();
  return handlers.POST(req);
}
