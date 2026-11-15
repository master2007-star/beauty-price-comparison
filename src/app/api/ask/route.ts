import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import {
  buildClassifyPrompt,
  buildGeneralAnswerPrompt,
  buildGroundedAnswerPrompt,
  callGemini,
  isGeminiConfigured,
  normalizeAskMessage,
  sanitizeHistory,
} from "@/lib/gemini";
import { isAuthorized } from "@/lib/guard";
import { runSearch } from "@/lib/search";
import type { AskResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const UNAVAILABLE: AskResponse = {
  status: "error",
  message: "The AI advisor is unavailable right now. Please try again in a moment.",
};

/**
 * AI beauty advisor. The model never sees anything but the user's words
 * and real runSearch results: it classifies the message, and when a
 * product is wanted the search goes through runSearch (beauty guard +
 * beauty filter apply) and the answer is grounded on those groups only.
 * No invented products or prices — the prompts encode the rule, and an
 * empty result list is reported plainly.
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
  const message = normalizeAskMessage((body as { message?: unknown })?.message);
  if (message === null) {
    return NextResponse.json({ error: "Message must be between 1 and 500 characters." }, { status: 400 });
  }
  const history = sanitizeHistory((body as { history?: unknown })?.history);

  if (!isGeminiConfigured()) {
    return NextResponse.json({ status: "not_configured" } satisfies AskResponse);
  }

  // Step 1: classify — product question (search) or general question?
  const classified = await callGemini(buildClassifyPrompt(message, history), { jsonMode: true });
  const searchQuery =
    typeof classified === "object" && classified !== null
      ? (classified as { searchQuery?: unknown }).searchQuery
      : undefined;
  if (searchQuery !== null && typeof searchQuery !== "string") {
    return NextResponse.json(UNAVAILABLE);
  }

  if (searchQuery) {
    // Step 2a: real search through the existing pipeline, then a
    // grounded answer that may only mention these results.
    const result = await runSearch(searchQuery.trim(), getConfig());
    const answer = await callGemini(buildGroundedAnswerPrompt(message, history, result.groups));
    if (answer === null) {
      return NextResponse.json(UNAVAILABLE);
    }
    return NextResponse.json({
      status: "ok",
      answer,
      searchQuery: searchQuery.trim(),
      groups: result.groups,
    } satisfies AskResponse);
  }

  // Step 2b: general skincare answer — no products, no prices.
  const answer = await callGemini(buildGeneralAnswerPrompt(message, history));
  if (answer === null) {
    return NextResponse.json(UNAVAILABLE);
  }
  return NextResponse.json({
    status: "ok",
    answer,
    searchQuery: null,
    groups: [],
  } satisfies AskResponse);
}
