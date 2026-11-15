"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Client boundary for the Auth.js session. Mounted only when Google login
 * is configured (the server decides via isGoogleLoginConfigured): with no
 * credentials set, no SessionProvider means no /api/auth/session fetch
 * and no extra requests at all — the app behaves exactly as before.
 */
export default function AuthSessionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return <SessionProvider>{children}</SessionProvider>;
}
