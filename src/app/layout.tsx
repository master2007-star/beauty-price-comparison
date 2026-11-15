import type { Metadata } from "next";
import Link from "next/link";
import LockGate from "@/components/LockGate";
import ProgressBar from "@/components/ProgressBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beauty Price Comparison — every store, one search",
  description:
    "Compare live Google Shopping prices for beauty products across every store. Same variant, same size — no invented prices.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ProgressBar />
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-name">
                Beauty Price<span className="brand-dot">.</span>
              </span>
              <span className="brand-tag">Compare</span>
            </Link>
            <nav className="nav-links" aria-label="Main">
              <Link href="/" className="nav-link">Search</Link>
              <Link href="/settings" className="nav-link">Settings</Link>
            </nav>
          </div>
        </header>
        <LockGate>
          <main>{children}</main>
        </LockGate>
        <footer className="footer">
          <div className="wrap footer-inner">
            <span>Prices come from live Google Shopping results via your configured providers. Nothing here is invented.</span>
            <Link href="/settings">Provider status &amp; setup →</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
