import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/guard";
import { getPriceHistory } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "locked", message: "Enter the app passcode first." }, { status: 401 });
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (!key || !key.trim()) {
    return NextResponse.json({ error: "Missing key parameter." }, { status: 400 });
  }

  const daysParam = url.searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : 30;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;

  const history = await getPriceHistory(key.trim(), safeDays);
  return NextResponse.json(history);
}
