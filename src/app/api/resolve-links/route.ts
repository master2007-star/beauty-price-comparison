import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { isAuthorized } from "@/lib/guard";
import { resolveDirectLink } from "@/lib/resolve";
import type { ResolveLinksRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "locked", message: "Enter the app passcode first." }, { status: 401 });
  }
  let body: ResolveLinksRequest;
  try {
    body = (await req.json()) as ResolveLinksRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const hasId = Boolean(body.productId ?? body.catalogId);
  const hasToken = Boolean(body.productToken ?? (body.productTokens && body.productTokens.length > 0));
  if (!hasId && !hasToken) {
    return NextResponse.json(
      { directUrl: null, matchedStore: null, source: null, reason: "No product id or token provided." },
      { status: 200 },
    );
  }
  const result = await resolveDirectLink(body, getConfig());
  return NextResponse.json(result);
}
