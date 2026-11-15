import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { isAuthorized } from "@/lib/guard";
import { runCompare } from "@/lib/search";

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
  const raw = (body as { queries?: unknown })?.queries;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "Provide 1 to 3 search queries." }, { status: 400 });
  }
  const queries = raw
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length >= 2 && q.length <= 120)
    .slice(0, 3);
  if (queries.length === 0) {
    return NextResponse.json({ error: "Provide 1 to 3 search queries (2–120 characters each)." }, { status: 400 });
  }
  const result = await runCompare(queries, getConfig());
  return NextResponse.json(result);
}
