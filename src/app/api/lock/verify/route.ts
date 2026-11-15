import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import {
  clearAttempts,
  clientKeyFromRequest,
  isLockedOut,
  isLockEnabled,
  recordFailedAttempt,
  sessionCookieHeader,
  verifyPasscode,
} from "@/lib/lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const cfg = getConfig();
  if (!isLockEnabled(cfg)) {
    return NextResponse.json({ unlocked: true });
  }
  const clientKey = clientKeyFromRequest(req);
  const lockout = isLockedOut(clientKey);
  if (lockout.locked) {
    return NextResponse.json(
      { error: "Too many wrong tries. Try again later.", retryAfterSeconds: lockout.retryAfterSeconds },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const passcode = typeof (body as { passcode?: unknown })?.passcode === "string"
    ? ((body as { passcode: string }).passcode ?? "")
    : "";
  if (!verifyPasscode(passcode, cfg)) {
    const outcome = recordFailedAttempt(clientKey);
    if (outcome.locked) {
      return NextResponse.json(
        { error: "Too many wrong tries. Locked for 5 minutes.", retryAfterSeconds: 300 },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Wrong passcode.", attemptsLeft: outcome.attemptsLeft },
      { status: 401 },
    );
  }
  clearAttempts(clientKey);
  const res = NextResponse.json({ unlocked: true });
  res.headers.set("Set-Cookie", sessionCookieHeader(cfg));
  return res;
}
