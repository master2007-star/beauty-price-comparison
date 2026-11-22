import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import LockGate from "@/components/LockGate";
import ProgressBar from "@/components/ProgressBar";
import TopStatus from "@/components/TopStatus";
import FooterProviders from "@/components/FooterProviders";
import { getConfig, isGoogleLoginConfigured } from "@/lib/env";
import { isLockEnabled, isValidSession } from "@/lib/lock";
import "./globals.css";

// Editorial serif display + clean sans body + mono labels, self-hosted at
// build time by next/font (no runtime font CDN). Exposed as CSS variables
// consumed by --font-display / --font-body / --font-mono in globals.css.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Beauty Price Comparison — every store, one search",
  description:
    "Compare live Google Shopping prices for beauty products across every store. Same variant, same size — no invented prices.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Decide the lock state on the server, from the request cookie + env, so
  // first paint already knows it: with no passcode set (the deployed case)
  // the page shell renders in the initial HTML instead of sitting behind a
  // blank client-side "checking" screen while a status fetch resolves.
  // The APIs enforce the lock too, and LockGate re-checks client-side if a
  // request ever comes back locked (session expiry). Reading cookies() opts
  // this layout into dynamic rendering — required for a per-request gate.
  const cfg = getConfig();
  const cookieHeader = (await cookies()).toString();
  const initialLocked = isLockEnabled(cfg) && !isValidSession(cookieHeader, cfg);
  // Optional Google login: decided server-side from env. When unconfigured
  // no session provider mounts and no login UI renders anywhere.
  const googleConfigured = isGoogleLoginConfigured();

  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${plexMono.variable}`}>
      <body>
        <AuthSessionProvider enabled={googleConfigured}>
          <ProgressBar />
          <TopStatus googleConfigured={googleConfigured} />
          <LockGate initialLocked={initialLocked}>
            <main>{children}</main>
          </LockGate>
        <footer className="footer">
          <div className="wrap">
            <div className="footer-top">
              <div>
                <p className="footer-title">Buy it once, at the right price.</p>
                <p className="footer-note">
                  Prices refresh with every search and come from Google Shopping via your own API keys. This app
                  does not sell anything itself.
                </p>
              </div>
              <div className="footer-pills">
                <Link href="/" className="footer-pill">
                  Search
                </Link>
                <Link href="/settings" className="footer-pill">
                  Settings &amp; keys
                </Link>
              </div>
            </div>
            <FooterProviders />
          </div>
        </footer>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
