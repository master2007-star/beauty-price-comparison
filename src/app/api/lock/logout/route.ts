import { NextResponse } from "next/server";
import { clearSessionCookieHeader } from "@/lib/lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ locked: true });
  res.headers.set("Set-Cookie", clearSessionCookieHeader());
  return res;
}
