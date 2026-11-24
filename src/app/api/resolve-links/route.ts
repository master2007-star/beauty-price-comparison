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
  const hasId =
    Boolean(body.productId) ||
    Boolean(body.catalogId) ||
    (body.productIds?.length ?? 0) > 0 ||
    (body.catalogIds?.length ?? 0) > 0;
  const hasToken =
    Boolean(body.productToken) ||
    (body.productTokens?.length ?? 0) > 0 ||
    (body.immersiveTokens?.length ?? 0) > 0;
  // A Google redirect product URL alone is enough: the resolver can
  // follow it server-side to the merchant page.
  const hasLink = Boolean(body.productUrl);
  // Identity-free offers can still use the guarded title + retailer fallback.
  const hasTitleAndStore = Boolean(body.title?.trim() && body.store?.trim());
  if (!hasId && !hasToken && !hasLink && !hasTitleAndStore) {
    return NextResponse.json(
      { directUrl: null, matchedStore: null, source: null, reason: "No product id, token, link, or title-and-retailer pair provided." },
      { status: 200 },
    );
  }
  const result = await resolveDirectLink(body, getConfig());
  return NextResponse.json(result);
}
