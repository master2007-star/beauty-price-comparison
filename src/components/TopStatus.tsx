"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { fetchStatus } from "@/lib/client-api";
import { PROVIDER_IDS } from "@/lib/types";

/** Status line exactly as the artifact shows it, built from /api/status. */
const STATUS_LABELS: Record<string, string> = {
  serpapi: "SERPAPI",
  searchapi: "SEARCHAPI.IO",
  serper: "SERPER",
  searlo: "SEARLO",
};

/**
 * Optional Google login controls. Rendered ONLY when Google login is
 * configured (the layout gates both this and the SessionProvider on the
 * same server-side flag), so useSession is never called without a
 * provider. Signed out: a pill linking to /login — the OAuth flow is
 * never auto-triggered from the top bar. Signed in: avatar + first name
 * + sign out. While the session loads, nothing extra renders.
 */
function AuthControls() {
  const { data: session, status } = useSession();

  if (status === "loading") return null;

  if (!session?.user) {
    return (
      <Link href="/login" className="status-auth">
        <span className="status-auth-mark" aria-hidden="true">
          G
        </span>
        <span className="status-auth-full">Sign in with Google</span>
        <span className="status-auth-short">Sign in</span>
      </Link>
    );
  }

  const firstName = session.user.name?.split(" ")[0] || "You";

  return (
    <span className="status-user">
      {session.user.image ? (
        <img src={session.user.image} alt="" className="status-avatar" referrerPolicy="no-referrer" />
      ) : null}
      <span className="status-name">{firstName}</span>
      <button type="button" className="status-signout" onClick={() => void signOut({ callbackUrl: "/" })}>
        Sign out
      </button>
    </span>
  );
}

export default function TopStatus({ googleConfigured }: { googleConfigured: boolean }) {
  const [line, setLine] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        const on = PROVIDER_IDS.filter((id) => s.providers[id]?.configured);
        setConnected(on.length > 0);
        setLine(
          on.length > 0
            ? `${on.map((id) => STATUS_LABELS[id]).join(" + ")} CONNECTED`
            : "NO PROVIDER KEYS CONNECTED",
        );
      })
      .catch(() => setLine("PROVIDER STATUS UNAVAILABLE"));
  }, []);

  return (
    <div className="statusbar">
      <div className="wrap statusbar-inner">
        <span className="status-line">
          <span className={`status-dot${connected ? " is-on" : ""}`} aria-hidden="true" />
          {line ?? "CHECKING PROVIDERS…"}
        </span>
        <span className="status-actions">
          {googleConfigured ? <AuthControls /> : null}
          <Link href="/settings" className="status-settings">
            Settings
          </Link>
        </span>
      </div>
    </div>
  );
}
