"use client";

import { useEffect, useState } from "react";
import { fetchStatus, logout } from "@/lib/client-api";
import type { StatusResponse } from "@/lib/types";
import { PROVIDER_IDS, PROVIDER_LABELS } from "@/lib/types";

export default function SettingsPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load status."));
  }, []);

  async function lockNow() {
    await logout();
    window.location.reload();
  }

  return (
    <div className="wrap" style={{ padding: "36px 0 60px" }}>
      <span className="eyebrow">Settings</span>
      <h1 className="display" style={{ fontSize: "clamp(2rem, 5vw, 3rem)", margin: "10px 0 8px" }}>
        Providers, locale &amp; lock
      </h1>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        This standalone build reads everything from server environment variables. Keys are never shown in full —
        only their last 4 characters — and never leave the server.
      </p>

      {error ? (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="settings-grid" style={{ marginTop: 28 }}>
        <section className="settings-card" aria-label="Provider status">
          <h3>Provider status</h3>
          {!status ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              {PROVIDER_IDS.map((id) => {
                const p = status.providers[id];
                return (
                  <div className="provider-row" key={id}>
                    <span>{PROVIDER_LABELS[id]}</span>
                    <span className={`pill ${p.configured ? "pill-on" : "pill-off"}`}>
                      {p.configured ? `configured · …${p.last4}` : "not configured"}
                    </span>
                  </div>
                );
              })}
              <p className="small muted" style={{ marginTop: 12 }}>
                Unconfigured providers are skipped silently; configured ones that fail show a warning on the
                results page.
              </p>
            </>
          )}
        </section>

        <section className="settings-card" aria-label="Locale">
          <h3>Search locale</h3>
          <div className="provider-row">
            <span>Region (gl)</span>
            <span className="pill">{status?.region ?? "…"}</span>
          </div>
          <div className="provider-row">
            <span>Language (hl)</span>
            <span className="pill">{status?.language ?? "…"}</span>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Set with the <code>REGION</code> and <code>LANGUAGE</code> environment variables. Defaults are{" "}
            <code>in</code> and <code>en</code>.
          </p>
        </section>

        <section className="settings-card" aria-label="App lock">
          <h3>App lock</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {status?.passcodeSet
              ? "A passcode is set (APP_PASSCODE). Visitors must enter it before the app or its APIs respond. 5 wrong tries lock a visitor out for 5 minutes."
              : "No passcode is set. Set APP_PASSCODE in the environment to lock the app behind a passcode gate. When unset, there is no lock screen at all."}
          </p>
          {status?.passcodeSet ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={lockNow}>
              Lock now (clear my session)
            </button>
          ) : null}
        </section>

        <section className="settings-card" aria-label="Environment variables">
          <h3>Environment variables</h3>
          <table className="env-table">
            <tbody>
              <tr>
                <td><code>SERPAPI_KEY</code></td>
                <td>SerpApi key (serpapi.com)</td>
              </tr>
              <tr>
                <td><code>SEARCHAPI_KEY</code></td>
                <td>SearchApi.io key (searchapi.io)</td>
              </tr>
              <tr>
                <td><code>SERPER_KEY</code></td>
                <td>Serper key (serper.dev)</td>
              </tr>
              <tr>
                <td><code>SEARLO_KEY</code></td>
                <td>Searlo key (searlo.tech)</td>
              </tr>
              <tr>
                <td><code>REGION</code></td>
                <td>Country code, default <code>in</code></td>
              </tr>
              <tr>
                <td><code>LANGUAGE</code></td>
                <td>Language code, default <code>en</code></td>
              </tr>
              <tr>
                <td><code>APP_PASSCODE</code></td>
                <td>Optional lock passcode</td>
              </tr>
              <tr>
                <td><code>SESSION_SECRET</code></td>
                <td>Optional cookie signing secret</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 12 }}>
            Locally: copy <code>.env.example</code> to <code>.env.local</code>. On Vercel: Project → Settings →
            Environment Variables, then redeploy.
          </p>
        </section>
      </div>
    </div>
  );
}
