import { NextResponse } from "next/server";
import { isCronAuthorized, shouldSendAlert } from "@/lib/alerts";
import { getActiveTracks, recordTrackAlert } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { getConfig } from "@/lib/env";
import { runSearch } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!isCronAuthorized(req.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cap at 20 products per run to protect search provider quotas
  const tracks = await getActiveTracks(20);
  if (tracks.length === 0) {
    return NextResponse.json({ ok: true, message: "No active tracks to check", checked: 0, alerted: 0 });
  }

  // Group by product_key to avoid redundant searches for the same product
  const tracksByProduct = new Map<string, typeof tracks>();
  for (const track of tracks) {
    const list = tracksByProduct.get(track.product_key) ?? [];
    list.push(track);
    tracksByProduct.set(track.product_key, list);
  }

  let alertedCount = 0;
  const cfg = getConfig();
  const siteUrl = process.env.NEXTAUTH_URL || "https://beauty-price-comparison.vercel.app";

  for (const [productKey, productTracks] of tracksByProduct.entries()) {
    const searchTitle = productTracks[0]?.title || productKey;
    try {
      const searchRes = await runSearch(searchTitle, cfg);
      if (!searchRes.groups || searchRes.groups.length === 0) continue;

      // Find the best matching group for this product_key
      const matchingGroup =
        searchRes.groups.find((g) => g.productKey === productKey) ?? searchRes.groups[0];
      const lowestPrice = matchingGroup.lowestPrice;

      if (!Number.isFinite(lowestPrice) || lowestPrice <= 0) continue;

      for (const track of productTracks) {
        if (shouldSendAlert(lowestPrice, track.target_price, track.last_alert_at)) {
          const productDisplay = track.title || "Your tracked beauty product";
          const unsubscribeUrl = `${siteUrl}/api/track/unsubscribe?token=${track.unsubscribe_token}`;
          const searchPageUrl = `${siteUrl}/?q=${encodeURIComponent(searchTitle)}`;

          const subject = `${productDisplay} dropped to ₹${lowestPrice} — your target was ₹${track.target_price}`;
          const html = `
            <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937; line-height: 1.5;">
              <h2 style="color: #111827; margin-top: 0;">Price Drop Alert 🎉</h2>
              <p>Great news! The price for <strong>${productDisplay}</strong> has dropped to or below your target price.</p>
              
              <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0 0 8px;"><strong>Current Lowest Price:</strong> <span style="color: #059669; font-size: 1.25rem; font-weight: bold;">₹${lowestPrice}</span></p>
                <p style="margin: 0;"><strong>Your Target Price:</strong> ₹${track.target_price}</p>
              </div>

              <p style="margin-bottom: 24px;">
                <a href="${searchPageUrl}" style="background: #d97736; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: 500;">
                  View Comparison & Stores
                </a>
              </p>

              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
              <p style="font-size: 0.85rem; color: #6b7280; margin: 0;">
                You received this because you tracked this product on Beauty Price Comparison.<br />
                <a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from alerts for this product</a>
              </p>
            </div>
          `;

          const emailRes = await sendEmail({
            to: track.email,
            subject,
            html,
          });

          if (emailRes.ok) {
            await recordTrackAlert(track.id);
            alertedCount++;
          } else {
            console.error(`Failed to send price alert to ${track.email}:`, emailRes.error);
          }
        }
      }
    } catch (err) {
      console.error(`Error checking price alerts for product ${productKey}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: tracks.length,
    alerted: alertedCount,
    timestamp: new Date().toISOString(),
  });
}
