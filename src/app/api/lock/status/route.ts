import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { isLockEnabled, isValidSession } from "@/lib/lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const cfg = getConfig();
  if (!isLockEnabled(cfg)) {
    return NextResponse.json({ locked: false, passcodeSet: false });
  }
  const unlocked = isValidSession(req.headers.get("cookie"), cfg);
  return NextResponse.json({ locked: !unlocked, passcodeSet: true });
}
