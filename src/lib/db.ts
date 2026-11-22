import { sql } from "@vercel/postgres";

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

/** Returns true if Postgres connection string is configured. */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
}

/**
 * Pure deduplication check:
 * Returns true if the price has changed or no previous snapshot exists.
 * Returns false if the price is identical (within 0.001) to skip writing duplicate snapshots.
 */
export function shouldRecordSnapshot(
  lastPrice: number | null | undefined,
  currentPrice: number,
): boolean {
  if (lastPrice === null || lastPrice === undefined || !Number.isFinite(lastPrice)) {
    return true;
  }
  return Math.abs(lastPrice - currentPrice) > 0.001;
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
        await sql`
          CREATE TABLE IF NOT EXISTS price_snapshots (
            id SERIAL PRIMARY KEY,
            product_key TEXT NOT NULL,
            title TEXT,
            store TEXT NOT NULL,
            price NUMERIC(10,2) NOT NULL,
            currency TEXT NOT NULL DEFAULT 'INR',
            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `;
        await sql`
          CREATE INDEX IF NOT EXISTS idx_snapshots_key_store_time
            ON price_snapshots (product_key, store, recorded_at);
        `;
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
    const latestPrices = new Map<string, number>();

    // Query latest price for each productKey
    await Promise.all(
      uniqueKeys.map(async (key) => {
        try {
          const { rows } = await sql<{ store: string; price: string | number }>`
            SELECT DISTINCT ON (store) store, price
            FROM price_snapshots
            WHERE product_key = ${key}
            ORDER BY store, recorded_at DESC
          `;
          for (const row of rows) {
            const pairKey = `${key}|${row.store.toLowerCase()}`;
            latestPrices.set(pairKey, Number(row.price));
          }
        } catch (queryErr) {
          console.error(`Failed to fetch latest prices for productKey ${key}:`, queryErr);
        }
      })
    );

    // Filter to only those whose price changed
    const toInsert: SnapshotOfferInput[] = [];
    for (const [pairKey, candidate] of batchMap.entries()) {
      const lastPrice = latestPrices.get(pairKey);
      if (shouldRecordSnapshot(lastPrice, candidate.price)) {
        toInsert.push(candidate);
      }
    }

    // Insert new snapshots
    for (const item of toInsert) {
      await sql`
        INSERT INTO price_snapshots (product_key, title, store, price, currency, recorded_at)
        VALUES (${item.productKey}, ${item.title}, ${item.store}, ${item.price}, ${item.currency || "INR"}, NOW())
      `;
    }
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

    const { rows } = await sql<{ price: string | number; recorded_at: string | Date }>`
      SELECT price, recorded_at
      FROM price_snapshots
      WHERE product_key = ${productKey.trim()}
        AND recorded_at >= ${cutoffDate}
      ORDER BY recorded_at ASC
    `;

    const records: PriceSnapshotRecord[] = rows.map((r) => ({
      price: Number(r.price),
      recorded_at: r.recorded_at,
    }));

    return computePriceHistorySeries(records);
  } catch (err) {
    console.error(`getPriceHistory error for key ${productKey}:`, err);
    return emptyResult;
  }
}
