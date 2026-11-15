"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

/** Google sign-in button for the /login page. Triggers the OAuth flow. */
export default function GoogleSignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="google-signin"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("google", { callbackUrl: "/" });
      }}
    >
      <span className="google-signin-mark" aria-hidden="true">
        G
      </span>
      {pending ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}
