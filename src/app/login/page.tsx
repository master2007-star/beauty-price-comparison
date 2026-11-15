import Link from "next/link";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { isGoogleLoginConfigured } from "@/lib/env";

/**
 * Auth.js redirects sign-in errors here (?error=<code>). The codes are
 * mapped to short, plain messages — the raw code is never rendered, so
 * no provider detail can leak into the page.
 */
const ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "Google sign-in isn't set up correctly on this deployment yet. The site works fine without signing in — head back and search.",
  AccessDenied:
    "Google didn't approve the sign-in. You can try again, or keep using the site without signing in.",
  OAuthSignin:
    "Google sign-in didn't start properly. Please try again — or keep using the site without signing in.",
  OAuthCallback:
    "Google sign-in didn't complete. Please try again — or keep using the site without signing in.",
  Callback:
    "Google sign-in didn't complete. Please try again — or keep using the site without signing in.",
  Default:
    "Something went wrong with sign-in. Please try again — or keep using the site without signing in.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawError = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage = rawError ? (ERROR_MESSAGES[rawError] ?? ERROR_MESSAGES.Default) : null;
  const configured = isGoogleLoginConfigured();

  return (
    <section className="login-wrap">
      <div className="login-card">
        <p className="login-eyebrow">Beauty Price Comparison</p>
        <h1 className="login-title">Sign in, if you like.</h1>
        <p className="login-note">
          Signing in is optional. The site works exactly the same without it — search, compare and open store pages
          need no account.
        </p>

        {errorMessage ? (
          <p className="login-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {configured ? (
          <GoogleSignInButton />
        ) : (
          <p className="login-unavailable">
            Google sign-in hasn&apos;t been set up on this deployment yet. Nothing is broken — just head back and
            search.
          </p>
        )}

        <Link href="/" className="login-home">
          ← Back to search
        </Link>
      </div>
    </section>
  );
}
