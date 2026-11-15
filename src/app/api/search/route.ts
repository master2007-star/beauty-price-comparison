import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { isAuthorized } from "@/lib/guard";
import { runSearch } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "locked", message: "Enter the app passcode first." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const query = typeof (body as { query?: unknown })?.query === "string"
    ? ((body as { query: string }).query.trim())
    : "";
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json({ error: "Query must be between 2 and 120 characters." }, { status: 400 });
  }
  const result = await runSearch(query, getConfig());
  return NextResponse.json(result);
}
