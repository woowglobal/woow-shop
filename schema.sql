-- WOOW Shop database (Cloudflare D1). Already created in your account; kept here for reference / local testing.
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, phone TEXT NOT NULL, customer TEXT NOT NULL, items TEXT NOT NULL, totals TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount_due INTEGER NOT NULL, amount_paid INTEGER NOT NULL DEFAULT 0, payment TEXT, zinc TEXT, delivery TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (url TEXT PRIMARY KEY, data TEXT NOT NULL, seen INTEGER NOT NULL);
