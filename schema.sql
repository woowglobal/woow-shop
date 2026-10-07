-- WOOW Shop database (Cloudflare D1). Already created in your account; kept here for reference / local testing.
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, phone TEXT NOT NULL, customer TEXT NOT NULL, items TEXT NOT NULL, totals TEXT NOT NULL, plan TEXT NOT NULL, method TEXT NOT NULL, amount_due INTEGER NOT NULL, amount_paid INTEGER NOT NULL DEFAULT 0, payment TEXT, zinc TEXT, delivery TEXT, user_id TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (url TEXT PRIMARY KEY, data TEXT NOT NULL, seen INTEGER NOT NULL);
-- analytics (who searches what, from which city) and Zinc call log (calls + cost for the dashboard)
CREATE TABLE IF NOT EXISTS track (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, sid TEXT, type TEXT NOT NULL, country TEXT, region TEXT, city TEXT, store TEXT, q TEXT, url TEXT, price_cents INTEGER, order_id TEXT, extra TEXT, user_id TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS idx_track_ts ON track(ts);
CREATE TABLE IF NOT EXISTS zinc_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, endpoint TEXT NOT NULL, retailer TEXT, q TEXT, ok INTEGER NOT NULL DEFAULT 1, cost_cents INTEGER NOT NULL DEFAULT 0, who TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS idx_zinc_ts ON zinc_calls(ts);
-- shared search cache: one paid Zinc search answers every customer for 6 hours
CREATE TABLE IF NOT EXISTS search_cache (k TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL);
-- back office: expenses (air freight, customs, warehouse, staff, courier, marketing, Zinc deposits…)
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'BDT', note TEXT, order_id TEXT, created_at TEXT NOT NULL);
-- customer accounts, sessions, bot/cost guard, admin login lockout
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT, pass TEXT NOT NULL, addresses TEXT, created_at TEXT NOT NULL, last_login TEXT, disabled INTEGER NOT NULL DEFAULT 0, google_sub TEXT, apple_sub TEXT, phone_verified INTEGER NOT NULL DEFAULT 0, methods TEXT);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, ip TEXT, admin INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS guard_block (who TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT, at INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS auth_fail (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_authfail ON auth_fail(k, ts);
CREATE INDEX IF NOT EXISTS idx_zinc_who ON zinc_calls(who, ts);
CREATE INDEX IF NOT EXISTS idx_track_sid ON track(sid, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple ON users(apple_sub);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
-- one-time WhatsApp login codes, and Google/Apple sign-ups waiting for a mobile number
CREATE TABLE IF NOT EXISTS otp (phone TEXT PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS pending_auth (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
