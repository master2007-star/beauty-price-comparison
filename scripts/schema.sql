-- Schema for price history and snapshots
-- Run automatically by ensureSchema() in src/lib/db.ts or manually via psql

CREATE TABLE IF NOT EXISTS price_snapshots (
  id SERIAL PRIMARY KEY,
  product_key TEXT NOT NULL,
  title TEXT,
  store TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_key_store_time
  ON price_snapshots (product_key, store, recorded_at);
