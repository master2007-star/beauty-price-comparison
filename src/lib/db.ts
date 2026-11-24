import crypto from "crypto";
import { createClient, createPool } from "@vercel/postgres";

export interface TrackedProductRecord {
  id: number;
  product_key: string;
  title: string | null;
  email: string;
  target_price: number;
  unsubscribe_token: string;
  active: boolean;
  created_at: Date | string;
  last_alert_at: Date | string | null;
}

export interface PriceSnapshotRecord {
  price: number;
  recorded_at: Date | string;
}

export interface PriceHistoryPoint {
  date: string;
  price: number;
}

export interface PriceHistoryResult {
  points: number;
  lowest: number | null;
  highest: number | null;
  current: number | null;
  series: PriceHistoryPoint[];
}

export interface SnapshotOfferInput {
  productKey: string;
  title: string;
  store: string;
  price: number;
  currency: string;
}

export function getConnectionString(): string | undefined {
  // First preference: Neon non-pooling direct connection
  if (process.env.HI98_POSTGRES_URL_NON_POOLING) return process.env.HI98_POSTGRES_URL_NON_POOLING;
  if (process.env.POSTGRES_URL_NON_POOLING && !process.env.POSTGRES_URL_NON_POOLING.includes("prisma.io")) {
    return process.env.POSTGRES_URL_NON_POOLING;
  }
  // Second preference: Neon pooled connection
  if (process.env.HI98_POSTGRES_URL) return process.env.HI98_POSTGRES_URL;
  if (process.env.HI98_DATABASE_URL) return process.env.HI98_DATABASE_URL;

  // Third: any non-prisma postgres url
  const anyPostgresKey = Object.keys(process.env).find(
    (k) => /POSTGRES_URL/i.test(k) && process.env[k] && !process.env[k]!.includes("prisma.io")
  );
  if (anyPostgresKey && process.env[anyPostgresKey]) return process.env[anyPostgresKey];

  // Fallback
  return (
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL
  );
}

/** Returns true if Postgres connection string is configured. */
export function isDatabaseConfigured(): boolean {
  return Boolean(getConnectionString());
}

/**
 * Safely executes queries using either createPool (for pooled URLs) or createClient (for direct URLs).
 */
export async function withClient<T>(fn: (client: { sql: any }) => Promise<T>): Promise<T> {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error("Missing Postgres connection string");
  }
  if (connectionString.includes("-pooler")) {
    const pool = createPool({ connectionString });
    return await fn(pool);
  } else {
    const client = createClient({ connectionString });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      try {
        await client.end();
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

/**
 * Pure deduplication check:
 * Returns true if the price has changed or no previous snapshot exists.
 * Returns false if the price is identical (within 0.001) to skip writing duplicate snapshots.
 */
export function shouldRecordSnapshot(
  lastPrice: number | null | undefined,
  currentPrice: number,
  lastRecordedAt?: Date | string | null,
  now = new Date(),
): boolean {
  if (lastPrice === null || lastPrice === undefined || !Number.isFinite(lastPrice)) {
    return true;
  }
  if (Math.abs(lastPrice - currentPrice) > 0.001) return true;
  // A stable price is still a real observation on a new date. Without
  // this, unchanged products never build daily history and eventually
  // lose every point from the 30-day window.
  if (lastRecordedAt !== undefined) {
    const previous = lastRecordedAt === null ? null : new Date(lastRecordedAt);
    return !previous || !Number.isFinite(previous.getTime()) ||
      previous.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
  }
  return false;
}

/**
 * Pure aggregation function:
 * Converts raw snapshots across time into a daily lowest-price series.
 * For any given calendar day, takes the lowest price seen across all stores.
 */
export function computePriceHistorySeries(
  snapshots: PriceSnapshotRecord[],
): PriceHistoryResult {
  if (!snapshots || snapshots.length === 0) {
    return {
      points: 0,
      lowest: null,
      highest: null,
      current: null,
      series: [],
    };
  }

  const dailyMins = new Map<string, number>();

  for (const s of snapshots) {
    const rawPrice = typeof s.price === "number" ? s.price : Number(s.price);
    if (!Number.isFinite(rawPrice) || rawPrice <= 0) continue;

    const d = s.recorded_at instanceof Date ? s.recorded_at : new Date(s.recorded_at);
    if (isNaN(d.getTime())) continue;

    const dateKey = d.toISOString().split("T")[0];
    const prev = dailyMins.get(dateKey);
    if (prev === undefined || rawPrice < prev) {
      dailyMins.set(dateKey, rawPrice);
    }
  }

  const sortedDates = [...dailyMins.keys()].sort();
  if (sortedDates.length === 0) {
    return {
      points: 0,
      lowest: null,
      highest: null,
      current: null,
      series: [],
    };
  }

  const series: PriceHistoryPoint[] = sortedDates.map((date) => ({
    date,
    price: dailyMins.get(date)!,
  }));

  const prices = series.map((pt) => pt.price);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const current = series[series.length - 1].price;

  return {
    points: series.length,
    lowest,
    highest,
    current,
    series,
  };
}

let schemaEnsuredPromise: Promise<void> | null = null;

/** Ensures the price_snapshots table and index exist. */
export async function ensureSchema(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (!schemaEnsuredPromise) {
    schemaEnsuredPromise = (async () => {
      try {
        await withClient(async (client) => {
          await client.sql`
            CREATE TABLE IF NOT EXISTS price_snapshots (
              id SERIAL PRIMARY KEY,
              product_key TEXT NOT NULL,
              title TEXT,
              store TEXT NOT NULL,
              price NUMERIC(10,2) NOT NULL,
              currency TEXT NOT NULL DEFAULT 'INR',
              recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
          `;
          await client.sql`
            CREATE INDEX IF NOT EXISTS idx_snapshots_key_store_time
              ON price_snapshots (product_key, store, recorded_at)
          `;
          await client.sql`
            CREATE TABLE IF NOT EXISTS tracked_products (
              id SERIAL PRIMARY KEY,
              product_key TEXT NOT NULL,
              title TEXT,
              email TEXT NOT NULL,
              target_price NUMERIC(10,2) NOT NULL,
              unsubscribe_token TEXT NOT NULL UNIQUE,
              active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              last_alert_at TIMESTAMPTZ
            )
          `;
          await client.sql`
            CREATE INDEX IF NOT EXISTS idx_tracked_active ON tracked_products (active, created_at)
          `;
        });
      } catch (err) {
        console.error("ensureSchema failed:", err);
        schemaEnsuredPromise = null; // allow retry on next call
      }
    })();
  }
  return schemaEnsuredPromise;
}

/**
 * Records snapshots for a batch of offers in the background.
 * Deduplicates by querying the latest snapshot for each (product_key, store).
 * If the latest price matches the current offer price, the insert is skipped.
 */
export async function recordSnapshots(offers: SnapshotOfferInput[]): Promise<void> {
  if (!isDatabaseConfigured() || offers.length === 0) return;

  try {
    await ensureSchema();

    // Group offers by (productKey, store), picking the lowest price in the current batch if duplicates exist
    const batchMap = new Map<string, SnapshotOfferInput>();
    for (const o of offers) {
      if (!o.productKey || !o.store || !Number.isFinite(o.price) || o.price <= 0) continue;
      const pairKey = `${o.productKey}|${o.store.toLowerCase()}`;
      const existing = batchMap.get(pairKey);
      if (!existing || o.price < existing.price) {
        batchMap.set(pairKey, o);
      }
    }

    const uniqueKeys = [...new Set(Array.from(batchMap.values()).map((o) => o.productKey))];
    const latestPrices = new Map<string, { price: number; recordedAt: Date | string }>();

    await withClient(async (client) => {
      // Query latest price for each productKey
      for (const key of uniqueKeys) {
        try {
          const res = await client.sql`
            SELECT DISTINCT ON (LOWER(store)) store, price, recorded_at
            FROM price_snapshots
            WHERE product_key = ${key}
            ORDER BY LOWER(store), recorded_at DESC
          `;
          const rows = res.rows as Array<{ store: string; price: string | number; recorded_at: Date | string }>;
          for (const row of rows) {
            const pairKey = `${key}|${row.store.toLowerCase()}`;
            latestPrices.set(pairKey, { price: Number(row.price), recordedAt: row.recorded_at });
          }
        } catch (queryErr) {
          console.error(`Failed to fetch latest prices for productKey ${key}:`, queryErr);
        }
      }

      // Filter to only those whose price changed
      const toInsert: SnapshotOfferInput[] = [];
      for (const [pairKey, candidate] of batchMap.entries()) {
        const last = latestPrices.get(pairKey);
        if (shouldRecordSnapshot(last?.price, candidate.price, last?.recordedAt)) {
          toInsert.push(candidate);
        }
      }

      // Insert new snapshots
      for (const item of toInsert) {
        await client.sql`
          INSERT INTO price_snapshots (product_key, title, store, price, currency, recorded_at)
          VALUES (${item.productKey}, ${item.title}, ${item.store}, ${item.price}, ${item.currency || "INR"}, NOW())
        `;
      }
    });
  } catch (err) {
    console.error("recordSnapshots error:", err);
  }
}

/**
 * Retrieves the daily lowest-price history for a product_key over the last N days.
 */
export async function getPriceHistory(
  productKey: string,
  days = 30,
): Promise<PriceHistoryResult> {
  const emptyResult: PriceHistoryResult = {
    points: 0,
    lowest: null,
    highest: null,
    current: null,
    series: [],
  };

  if (!isDatabaseConfigured() || !productKey || !productKey.trim()) {
    return emptyResult;
  }

  try {
    await ensureSchema();

    const safeDays = Math.max(1, Math.min(365, days));
    const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();

    return await withClient(async (client) => {
      const res = await client.sql`
        SELECT price, recorded_at
        FROM price_snapshots
        WHERE product_key = ${productKey.trim()}
          AND recorded_at >= ${cutoffDate}
        ORDER BY recorded_at ASC
      `;

      const rows = res.rows as Array<{ price: string | number; recorded_at: string | Date }>;
      const records: PriceSnapshotRecord[] = rows.map((r: { price: string | number; recorded_at: string | Date }) => ({
        price: Number(r.price),
        recorded_at: r.recorded_at,
      }));

      return computePriceHistorySeries(records);
    });
  } catch (err) {
    console.error(`getPriceHistory error for key ${productKey}:`, err);
    return emptyResult;
  }
}

/**
 * Creates a new price alert subscription in tracked_products.
 * Includes abuse guard: maximum 5 active tracks per email created in 24 hours.
 */
export async function createTrackedProduct(input: {
  product_key: string;
  title?: string;
  email: string;
  target_price: number;
}): Promise<{ ok: boolean; error?: string; token?: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: "Database is not configured." };
  }

  try {
    await ensureSchema();
    const token = crypto.randomBytes(24).toString("hex");

    return await withClient(async (client) => {
      // Abuse check: max 5 active tracks per email in the last 24h
      const countRes = await client.sql`
        SELECT COUNT(*)::int as count
        FROM tracked_products
        WHERE LOWER(email) = LOWER(${input.email})
          AND created_at >= NOW() - INTERVAL '24 hours'
          AND active = TRUE
      `;
      const count = Number(countRes.rows[0]?.count ?? 0);
      if (count >= 5) {
        return {
          ok: false,
          error: "Track limit reached: maximum 5 active product alerts per email per day.",
        };
      }

      await client.sql`
        INSERT INTO tracked_products (
          product_key,
          title,
          email,
          target_price,
          unsubscribe_token,
          active
        ) VALUES (
          ${input.product_key},
          ${input.title ?? null},
          ${input.email.toLowerCase()},
          ${input.target_price},
          ${token},
          TRUE
        )
      `;

      return { ok: true, token };
    });
  } catch (err) {
    console.error("createTrackedProduct error:", err);
    return { ok: false, error: "Failed to save alert in database." };
  }
}

/**
 * Deactivates a price alert via unsubscribe token.
 */
export async function unsubscribeTrackedProduct(
  token: string,
): Promise<{ ok: boolean; title?: string | null; email?: string }> {
  if (!isDatabaseConfigured() || !token) {
    return { ok: false };
  }

  try {
    await ensureSchema();
    return await withClient(async (client) => {
      const res = await client.sql`
        UPDATE tracked_products
        SET active = FALSE
        WHERE unsubscribe_token = ${token}
        RETURNING title, email
      `;
      if (res.rows.length === 0) {
        return { ok: false };
      }
      const row = res.rows[0] as { title: string | null; email: string };
      return { ok: true, title: row.title, email: row.email };
    });
  } catch (err) {
    console.error("unsubscribeTrackedProduct error:", err);
    return { ok: false };
  }
}

/**
 * Loads active tracks created within the last 30 days, capped at `limit` (default 20).
 */
export async function getActiveTracks(limit: number = 20): Promise<TrackedProductRecord[]> {
  if (!isDatabaseConfigured()) return [];

  try {
    await ensureSchema();
    return await withClient(async (client) => {
      const res = await client.sql`
        SELECT id, product_key, title, email, target_price, unsubscribe_token, active, created_at, last_alert_at
        FROM tracked_products
        WHERE active = TRUE
          AND created_at >= NOW() - INTERVAL '30 days'
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;
      return (res.rows as any[]).map((r) => ({
        id: Number(r.id),
        product_key: String(r.product_key),
        title: r.title ? String(r.title) : null,
        email: String(r.email),
        target_price: Number(r.target_price),
        unsubscribe_token: String(r.unsubscribe_token),
        active: Boolean(r.active),
        created_at: r.created_at,
        last_alert_at: r.last_alert_at,
      }));
    });
  } catch (err) {
    console.error("getActiveTracks error:", err);
    return [];
  }
}

/**
 * Sets last_alert_at = NOW() for a notified track.
 */
export async function recordTrackAlert(id: number): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await withClient(async (client) => {
      await client.sql`
        UPDATE tracked_products
        SET last_alert_at = NOW()
        WHERE id = ${id}
      `;
    });
  } catch (err) {
    console.error(`recordTrackAlert failed for id ${id}:`, err);
  }
}
