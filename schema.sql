-- WOOW Shop database (Cloudflare D1). Already created in your account; kept here for reference / local testing.
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, phone TEXT NOT NULL, customer TEXT NOT NULL, items TEXT NOT NULL, totals TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount_due INTEGER NOT NULL, amount_paid INTEGER NOT NULL DEFAULT 0, payment TEXT, zinc TEXT, delivery TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (url TEXT PRIMARY KEY, data TEXT NOT NULL, seen INTEGER NOT NULL);
-- analytics (who searches what, from which city) and Zinc call log (calls + cost for the dashboard)
CREATE TABLE IF NOT EXISTS track (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, sid TEXT, type TEXT NOT NULL, country TEXT, region TEXT, city TEXT, store TEXT, q TEXT, url TEXT, price_cents INTEGER, order_id TEXT, extra TEXT);
CREATE INDEX IF NOT EXISTS idx_track_ts ON track(ts);
CREATE TABLE IF NOT EXISTS zinc_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, endpoint TEXT NOT NULL, retailer TEXT, q TEXT, ok INTEGER NOT NULL DEFAULT 1, cost_cents INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_zinc_ts ON zinc_calls(ts);
-- shared search cache: one paid Zinc search answers every customer for 6 hours
CREATE TABLE IF NOT EXISTS search_cache (k TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL);
-- back office: expenses (air freight, customs, warehouse, staff, courier, marketing, Zinc deposits…)
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'BDT', note TEXT, order_id TEXT, created_at TEXT NOT NULL);
