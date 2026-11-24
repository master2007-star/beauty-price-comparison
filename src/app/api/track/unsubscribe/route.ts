import { NextResponse } from "next/server";
import { unsubscribeTrackedProduct } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim();

  if (!token) {
    return new NextResponse(renderHtml("Invalid link", "No unsubscribe token was provided."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const result = await unsubscribeTrackedProduct(token);

  if (!result.ok) {
    return new NextResponse(
      renderHtml("Not found", "This alert is either already unsubscribed or the link is invalid."),
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }

  const title = result.title ? `“${escapeHtml(result.title)}”` : "this product";
  return new NextResponse(
    renderHtml("Unsubscribed", `You have successfully unsubscribed from price drop alerts for ${title}.`),
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Beauty Price Comparison</title>
  <style>
    body {
      background-color: #0b0c10;
      color: #e0e2ec;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
    }
    .card {
      background: #151821;
      border: 1px solid #232838;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 600;
      margin: 0 0 12px;
      color: #f5f6fa;
    }
    p {
      color: #9ba1b6;
      line-height: 1.5;
      font-size: 0.95rem;
      margin: 0 0 24px;
    }
    a.btn {
      display: inline-block;
      background: #d97736;
      color: #fff;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.15s ease;
    }
    a.btn:hover {
      background: #c2652b;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    <a href="/" class="btn">Back to Beauty Price Comparison</a>
  </div>
</body>
</html>`;
}
