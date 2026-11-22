import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/guard";
import { getPriceHistory, isDatabaseConfigured } from "@/lib/db";

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

  if (key.trim() === "debug") {
    try {
      const { ensureSchema, withClient } = await import("@/lib/db");
      await ensureSchema();
      const info = await withClient(async (client) => {
        const countRes = await client.sql`SELECT COUNT(*) FROM price_snapshots`;
        const sample = await client.sql`SELECT * FROM price_snapshots ORDER BY id DESC LIMIT 5`;
        return { count: countRes.rows[0]?.count, sample: sample.rows };
      });
      return NextResponse.json({
        configured: isDatabaseConfigured(),
        ...info,
      });
    } catch (err: unknown) {
      const e = err as { message?: string; stack?: string };
      return NextResponse.json({
        configured: isDatabaseConfigured(),
        error: e?.message,
      });
    }
  }

  const daysParam = url.searchParams.get("days");
  const days = daysParam ? parseInt(daysParam, 10) : 30;
  const safeDays = Number.isFinite(days) && days > 0 ? days : 30;

  const history = await getPriceHistory(key.trim(), safeDays);
  const res = NextResponse.json(history);
  res.headers.set("x-db-configured", String(isDatabaseConfigured()));
  return res;
}
