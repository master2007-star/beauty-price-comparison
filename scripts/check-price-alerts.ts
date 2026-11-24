/**
 * Verification for price-drop alerts:
 *  - Validation rejects invalid email and non-positive target prices
 *  - Pure alert decision logic (shouldSendAlert)
 *  - Cron authorization checks
 *  - DB checks (runs if POSTGRES_URL is configured, skips gracefully if not)
 * Run: npx tsx scripts/check-price-alerts.ts
 */
import { isCronAuthorized, shouldSendAlert, validateTrackInput } from "../src/lib/alerts";
import { isDatabaseConfigured, createTrackedProduct, getActiveTracks, unsubscribeTrackedProduct } from "../src/lib/db";

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n--- Price drop alerts unit checks ---");

/* ------------------- Validation checks -------------------- */

// 1. Missing or invalid email
check(
  "validation rejects missing email",
  Boolean(validateTrackInput({ product_key: "p1", email: "", target_price: 500 }).error),
);
check(
  "validation rejects invalid email without domain",
  Boolean(validateTrackInput({ product_key: "p1", email: "user@", target_price: 500 }).error),
);
check(
  "validation rejects invalid email without username",
  Boolean(validateTrackInput({ product_key: "p1", email: "@example.com", target_price: 500 }).error),
);
check(
  "validation rejects plain text string as email",
  Boolean(validateTrackInput({ product_key: "p1", email: "not-an-email", target_price: 500 }).error),
);

// 2. Non-positive or invalid target price
check(
  "validation rejects zero target price",
  Boolean(validateTrackInput({ product_key: "p1", email: "test@example.com", target_price: 0 }).error),
);
check(
  "validation rejects negative target price",
  Boolean(validateTrackInput({ product_key: "p1", email: "test@example.com", target_price: -100 }).error),
);
check(
  "validation rejects non-numeric target price",
  Boolean(validateTrackInput({ product_key: "p1", email: "test@example.com", target_price: "free" }).error),
);

// 3. Valid inputs
const valid = validateTrackInput({
  product_key: "p1",
  email: "User@Example.COM",
  target_price: "499.50",
  title: "Test Serum",
});
check("validation accepts valid track input", !valid.error && Boolean(valid.data));
check("validation normalizes email to lowercase", valid.data?.email === "user@example.com");
check("validation parses numeric string target_price", valid.data?.target_price === 499.5);

/* ----------------- Pure alert decision logic ------------------ */

const now = Date.now();
const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000);
const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000);

// lowest 800, target 900, no alert in 24h → send
check(
  "shouldSendAlert: lowest 800, target 900, never alerted → send (true)",
  shouldSendAlert(800, 900, null, now) === true,
);

// lowest 800, target 900, alerted 25h ago → send
check(
  "shouldSendAlert: lowest 800, target 900, alerted 25h ago → send (true)",
  shouldSendAlert(800, 900, twentyFiveHoursAgo, now) === true,
);

// lowest 950, target 900 → don't send (price above target)
check(
  "shouldSendAlert: lowest 950, target 900 → don't send (false)",
  shouldSendAlert(950, 900, null, now) === false,
);

// lowest 800, target 900, alerted 2h ago → don't send (24h cooldown)
check(
  "shouldSendAlert: lowest 800, target 900, alerted 2h ago → don't send (false)",
  shouldSendAlert(800, 900, twoHoursAgo, now) === false,
);

// lowest 800, target 800 → send (exact match)
check(
  "shouldSendAlert: lowest 800, target 800 (exact target hit) → send (true)",
  shouldSendAlert(800, 800, null, now) === true,
);

/* ------------------ Cron authorization checks ------------------ */

const SECRET = "test-cron-secret-12345";
check(
  "isCronAuthorized: matches Bearer secret",
  isCronAuthorized(`Bearer ${SECRET}`, SECRET) === true,
);
check(
  "isCronAuthorized: rejects missing auth header",
  isCronAuthorized(null, SECRET) === false,
);
check(
  "isCronAuthorized: rejects mismatched secret",
  isCronAuthorized("Bearer wrong-secret", SECRET) === false,
);
check(
  "isCronAuthorized: rejects basic auth format",
  isCronAuthorized(`Basic ${SECRET}`, SECRET) === false,
);
check(
  "isCronAuthorized: rejects when CRON_SECRET is empty/unset",
  isCronAuthorized(`Bearer ${SECRET}`, "") === false,
);

/* -------------------- DB checks (if configured) -------------------- */

async function runDbChecks() {
  if (!isDatabaseConfigured()) {
    console.log("\n  SKIP db-dependent checks: POSTGRES_URL is not set locally (expected in local dev)");
    finish();
    return;
  }

  console.log("\n--- DB integration checks ---");
  try {
    const testKey = `alert-test-${Date.now()}`;
    const testEmail = `test-${Date.now()}@example.com`;

    const createRes = await createTrackedProduct({
      product_key: testKey,
      title: "Test Alert Cream",
      email: testEmail,
      target_price: 350,
    });
    check("createTrackedProduct writes to DB", createRes.ok && Boolean(createRes.token));

    const tracks = await getActiveTracks(50);
    const found = tracks.find((t) => t.product_key === testKey && t.email === testEmail);
    check("getActiveTracks returns newly created track", Boolean(found));

    if (createRes.token) {
      const unsubRes = await unsubscribeTrackedProduct(createRes.token);
      check("unsubscribeTrackedProduct succeeds with valid token", unsubRes.ok === true);

      const tracksAfter = await getActiveTracks(50);
      const stillActive = tracksAfter.some((t) => t.unsubscribe_token === createRes.token);
      check("unsubscribed track is excluded from active tracks", stillActive === false);
    }
  } catch (err) {
    console.error("DB check error:", err);
    failures++;
  }
  finish();
}

function finish() {
  console.log(failures === 0 ? "\nAll price alerts checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

runDbChecks();
