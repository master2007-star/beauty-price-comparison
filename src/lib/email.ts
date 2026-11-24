/**
 * Email sender via Resend REST API (free tier, 100 emails/day, 3,000/month).
 * Uses standard fetch with zero external npm dependencies.
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY environment variable is not configured." };
  }

  // Resend free tier onboarding sender
  const from = "Beauty Price Comparison <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg =
        typeof data?.message === "string"
          ? data.message
          : `HTTP ${res.status} from Resend API`;
      return { ok: false, error: errMsg };
    }

    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
