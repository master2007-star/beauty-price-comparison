"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { fetchLockStatus, verifyPasscode } from "@/lib/client-api";

function PasscodeForm({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode) return;
    setBusy(true);
    setError("");
    const result = await verifyPasscode(passcode);
    setBusy(false);
    if (result.ok) {
      onUnlock();
      return;
    }
    if (result.retryAfterSeconds) {
      setError(`Too many wrong tries. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`);
    } else if (typeof result.attemptsLeft === "number") {
      setError(`Wrong passcode. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left before a 5-minute lockout.`);
    } else {
      setError(result.error ?? "Could not unlock. Try again.");
    }
    setPasscode("");
  }

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submit}>
        <span className="eyebrow">Private app</span>
        <h1 className="display">Enter the passcode</h1>
        <p>This copy of the app is locked. The passcode is set by the app owner in the server environment.</p>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          aria-label="App passcode"
          autoFocus
        />
        <p className="lock-error" role="alert">{error}</p>
        <button className="btn btn-terra" type="submit" disabled={busy || !passcode} style={{ width: "100%" }}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

/**
 * Renders children only when the app is unlocked. The initial decision comes
 * from the server (layout.tsx reads the session cookie + env), so first
 * paint never waits on a client-side status fetch: with no passcode set the
 * page renders immediately, and with a passcode set the form renders
 * immediately. Fails closed: if a later lock check fails, the gate goes up
 * (the APIs enforce it too), and any 401 "locked" response re-checks.
 */
export default function LockGate({
  children,
  initialLocked,
}: {
  children: ReactNode;
  initialLocked: boolean;
}) {
  const [state, setState] = useState<"locked" | "open">(initialLocked ? "locked" : "open");

  const check = useCallback(async () => {
    try {
      const status = await fetchLockStatus();
      setState(status.locked ? "locked" : "open");
    } catch {
      setState("locked");
    }
  }, []);

  useEffect(() => {
    const handler = () => check();
    window.addEventListener("bp:locked", handler);
    return () => window.removeEventListener("bp:locked", handler);
  }, [check]);

  if (state === "locked") {
    return <PasscodeForm onUnlock={() => setState("open")} />;
  }

  return <>{children}</>;
}
