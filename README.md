# WOOW Shop — Buy For Me in Taka (Cloudflare edition)

Customers search US stores (Amazon, Walmart, Target, Best Buy, Macy's, Costco), see the **price delivered to Dhaka in ৳**, pay with **bKash, Nagad, card or bank transfer**, and WOOW buys the items through **Zinc**, shipped to the WOOW US warehouse.

Runs entirely on **Cloudflare Workers + D1** — no server to manage.

👉 **Bangla step-by-step: [GUIDE-BN.md](GUIDE-BN.md)**

## Structure

| Path | What |
|---|---|
| `worker/index.js` | API routes, payments, admin API, Zinc webhook, 30-min cron to refresh Zinc orders |
| `worker/zinc.js` | Zinc v2: search, product details, place order, order status (demo data when no key) |
| `worker/sslcommerz.js` | SSLCommerz payment start + server-side validation |
| `worker/pricing.js` | Rate, fee, per-kg shipping, delivery plan (warehouse → flight → Dhaka) |
| `web/` | **Edit here.** Readable website sources (shop, tracking, admin) |
| `public/` | Built, minified copy served to browsers — run `npm run build` after editing `web/` |
| `worker/auth.js` | Customer accounts (mobile + password, PBKDF2), sessions, saved addresses |
| `worker/guard.js` | Bot & paid-lookup guard (per visitor / account / IP), blocks shown in Admin |
| `wrangler.jsonc` | Worker config, D1 binding, cron, non-secret settings |
| `schema.sql` | Database tables (already created in the `woow-shop-db` D1 database) |

## Deploy

Connect this repo in Cloudflare → Workers & Pages → Create → **Import a repository** (project name `woow-shop`). Every push to `main` deploys automatically.

Secrets (Settings → Variables and Secrets, type **Secret**): `ADMIN_PASSWORD`, `ZINC_API_KEY`, `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWORD`, optional `FLIGHTS_API_KEY`, optional `GOOGLE_MAPS_KEY` (browser key restricted to your domain, Places API) for Google-verified addresses.

Webhooks: Zinc → `https://YOUR-DOMAIN/webhooks/zinc` · SSLCommerz IPN → `https://YOUR-DOMAIN/pay/ipn`

## Local development

```bash
npm install
echo "ADMIN_PASSWORD=test123" > .dev.vars
npm run db:local
npm run dev      # http://localhost:8787  and  /admin
```

## Prices customers see

Product (same price as the store) + **US delivery to the WOOW warehouse** (free over each store's limit, e.g. Amazon $35; Zinc live offers data when available, otherwise the rules in Admin → Settings) + **US sales tax** (Delaware 0%, New York 8.875% — set the warehouse state in Settings) + WOOW fee + air shipping to Dhaka.

## Admin

- **Dashboard** — visitors, searches, views, carts, orders, payments, customers by zone (city/region from Cloudflare), top searches/products, Zinc wallet balance, Zinc calls and cost per day.
- **Purchase sheet** — every paid item to buy now (link, option, qty, price). Mark *Bought* / *Can't buy* → GENI posts the update on the customer's order page; WhatsApp message ready; CSV export.

## Zinc cost savers

Shared 6 h search cache (D1, same answer for every customer) · home page rails and *Recently viewed* built from WOOW's own data (no Zinc calls) · compare uses saved products first · live price re-used for 15 min · shipping offers looked up only below the free-delivery limit (saved 24 h) · daily Zinc budget: over it, search answers from saved products.

## Order flow

`awaiting_payment` → (`bank_review`) → `paid` → **Buy with Zinc** → `purchasing` → `purchased` → `at_warehouse` → `in_flight` → `in_dhaka` → `delivered`

## Safety

- Customers must sign in (mobile + password) to use the cart, request a price or pay. Wrong passwords are rate-limited; admin login locks for 15 min after 10 wrong tries.
- Customer pages never mention the supplier; supplier errors are replaced by plain messages; internal purchase notes are hidden from order tracking; `admin.js` is served only after admin login.
- Paid store lookups are guarded: bots get saved data only; too many lookups/views in 30 min blocks paid lookups for that visitor (Admin → Dashboard → Security).
- `public/_headers` sets CSP, HSTS and other security headers.

- Prices are recalculated on the server from saved product data; the browser can't change them.
- Payments count only after SSLCommerz validation; duplicate callbacks are ignored.
- Zinc webhooks trigger a re-check with Zinc; nothing is trusted from the message itself.
- Zinc `max_price` = item price + `ZINC_MAX_PRICE_BUFFER_PERCENT`.
- Collecting Taka for US purchases falls under Bangladesh Bank FX and import rules — confirm with a Bangladeshi lawyer/accountant before launch.
