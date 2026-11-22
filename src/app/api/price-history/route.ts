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
      const { getConnectionString } = await import("@/lib/db");
      const conn = getConnectionString() || "";
      let host = "none";
      try {
        const u = new URL(conn.replace(/^prisma\+/, ""));
        host = u.hostname;
      } catch {
        host = "unparseable";
      }
      const relevantEnvVars = Object.keys(process.env).filter((k) =>
        /POSTGRES|DATABASE|NEON|STORAGE|PRISMA/i.test(k)
      );
      return NextResponse.json({
        configured: isDatabaseConfigured(),
        host,
        envVars: relevantEnvVars,
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
