import { NextResponse } from "next/server";
import { buildRewritePrompt, callGemini, isGeminiConfigured, normalizeSmartQuery } from "@/lib/gemini";
import { isAuthorized } from "@/lib/guard";
import type { SmartSearchResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Query rewrite only — this route never runs a search. The client takes
 * the rewritten query and runs the normal /api/search with it, so the
 * beauty guard + filter apply exactly as they do for a typed query.
 * On any failure the client silently falls back to the raw query.
 */
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
  const query = normalizeSmartQuery((body as { query?: unknown })?.query);
  if (query === null) {
    return NextResponse.json({ error: "Query must be between 1 and 200 characters." }, { status: 400 });
  }

  if (!isGeminiConfigured()) {
    return NextResponse.json({ status: "not_configured" } satisfies SmartSearchResponse);
  }

  const rewritten = await callGemini(buildRewritePrompt(query), { jsonMode: true });
  const rewrittenQuery =
    typeof rewritten === "object" && rewritten !== null
      ? (rewritten as { rewrittenQuery?: unknown }).rewrittenQuery
      : undefined;
  if (typeof rewrittenQuery !== "string" || rewrittenQuery.trim().length === 0) {
    return NextResponse.json({ status: "error" } satisfies SmartSearchResponse);
  }
  return NextResponse.json({
    status: "ok",
    rewrittenQuery: rewrittenQuery.trim().slice(0, 200),
  } satisfies SmartSearchResponse);
}
