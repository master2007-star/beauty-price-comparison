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
 * Renders children only when the app is unlocked. Fails closed: if the lock
 * status cannot be checked, the gate stays up (the APIs enforce it too).
 */
export default function LockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");

  const check = useCallback(async () => {
    try {
      const status = await fetchLockStatus();
      setState(status.locked ? "locked" : "open");
    } catch {
      setState("locked");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const handler = () => check();
    window.addEventListener("bp:locked", handler);
    return () => window.removeEventListener("bp:locked", handler);
  }, [check]);

  if (state === "checking") {
    return (
      <div className="lock-screen">
        <div className="loading-dots" aria-label="Loading">
          <span className="dot-pulse" />
          <span className="dot-pulse" />
          <span className="dot-pulse" />
        </div>
      </div>
    );
  }

  if (state === "locked") {
    return <PasscodeForm onUnlock={() => setState("open")} />;
  }

  return <>{children}</>;
}
