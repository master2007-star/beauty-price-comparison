import { NextResponse } from "next/server";
import { validateTrackInput } from "@/lib/alerts";
import { createTrackedProduct, isDatabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { error, data } = validateTrackInput(body);
  if (error || !data) {
    return NextResponse.json({ error: error ?? "Invalid input" }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Price tracking is currently unavailable (database not configured)." },
      { status: 503 },
    );
  }

  const result = await createTrackedProduct(data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to create price alert." },
      { status: result.error?.includes("limit") ? 429 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: `We'll email you when this drops to ₹${data.target_price} or below.`,
  });
}
