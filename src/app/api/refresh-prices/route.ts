import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { isAuthorized } from "@/lib/guard";
import { refreshLivePrices } from "@/lib/live-price";
import type { RefreshPricesItem, RefreshPricesRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

function validItem(v: unknown): RefreshPricesItem | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== "string" || o.key.length === 0) return null;
  if (typeof o.store !== "string" || o.store.length === 0) return null;
  if (typeof o.price !== "number" || !Number.isFinite(o.price) || o.price <= 0) return null;
  const str = (x: unknown): string | undefined =>
    typeof x === "string" && x.length > 0 ? x : undefined;
  return {
    key: o.key,
    store: o.store,
    price: o.price,
    productId: str(o.productId),
    catalogId: str(o.catalogId),
    productIds: asStringArray(o.productIds),
    catalogIds: asStringArray(o.catalogIds),
    productToken: str(o.productToken),
    productTokens: asStringArray(o.productTokens),
    immersiveTokens: asStringArray(o.immersiveTokens),
    productUrl: str(o.productUrl),
    title: str(o.title),
    groupTitle: str(o.groupTitle),
  };
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "locked", message: "Enter the app passcode first." }, { status: 401 });
  }
  let body: RefreshPricesRequest;
  try {
    body = (await req.json()) as RefreshPricesRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(body.items)) {
    return NextResponse.json({ error: "Expected { items: [...] }." }, { status: 400 });
  }
  // Malformed items are dropped (their rows simply keep the Google
  // price); the item cap lives in refreshLivePrices.
  const items = body.items.map(validItem).filter((x): x is RefreshPricesItem => x !== null);
  const results = await refreshLivePrices(items, getConfig());
  return NextResponse.json({ results });
}
