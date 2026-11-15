import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Optional Google login (Auth.js v5, JWT sessions, no database).
 *
 * The site stays fully usable without signing in: no route is gated and no
 * middleware redirects. When the Google credentials below are absent, the
 * providers list is empty, the login button is hidden (see
 * isGoogleLoginConfigured in lib/env), and the app behaves exactly as
 * before. This is entirely separate from the APP_PASSCODE app lock.
 *
 * Env vars (set in Vercel, never hardcoded): AUTH_GOOGLE_ID,
 * AUTH_GOOGLE_SECRET, AUTH_SECRET. Auth.js reads AUTH_SECRET itself for
 * signing the JWT session cookie. AUTH_URL, when set, takes precedence
 * for the callback URL; otherwise trustHost lets Auth.js build it from
 * the request host, which is what the Vercel deployment needs.
 *
 * The OAuth callback URL registered in Google Cloud Console must be:
 * https://beauty-price-comparison.vercel.app/api/auth/callback/google
 * (Auth.js's default callback path for the Google provider — do not
 * customize it, or the registered URL stops matching.)
 */
const googleClientId = process.env.AUTH_GOOGLE_ID?.trim() || undefined;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET?.trim() || undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers:
    googleClientId && googleClientSecret
      ? [Google({ clientId: googleClientId, clientSecret: googleClientSecret })]
      : [],
});
