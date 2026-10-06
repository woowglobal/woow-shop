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
| `public/` | Shop (`index.html`), tracking (`order.html`), admin (`admin.html`), demo payment |
| `wrangler.jsonc` | Worker config, D1 binding, cron, non-secret settings |
| `schema.sql` | Database tables (already created in the `woow-shop-db` D1 database) |

## Deploy

Connect this repo in Cloudflare → Workers & Pages → Create → **Import a repository** (project name `woow-shop`). Every push to `main` deploys automatically.

Secrets (Settings → Variables and Secrets, type **Secret**): `ADMIN_PASSWORD`, `ZINC_API_KEY`, `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWORD`.

Webhooks: Zinc → `https://YOUR-DOMAIN/webhooks/zinc` · SSLCommerz IPN → `https://YOUR-DOMAIN/pay/ipn`

## Local development

```bash
npm install
echo "ADMIN_PASSWORD=test123" > .dev.vars
npm run db:local
npm run dev      # http://localhost:8787  and  /admin
```

## Order flow

`awaiting_payment` → (`bank_review`) → `paid` → **Buy with Zinc** → `purchasing` → `purchased` → `at_warehouse` → `in_flight` → `in_dhaka` → `delivered`

## Safety

- Prices are recalculated on the server from saved product data; the browser can't change them.
- Payments count only after SSLCommerz validation; duplicate callbacks are ignored.
- Zinc webhooks trigger a re-check with Zinc; nothing is trusted from the message itself.
- Zinc `max_price` = item price + `ZINC_MAX_PRICE_BUFFER_PERCENT`.
- Collecting Taka for US purchases falls under Bangladesh Bank FX and import rules — confirm with a Bangladeshi lawyer/accountant before launch.
