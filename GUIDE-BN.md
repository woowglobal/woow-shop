# WOOW Shop — Cloudflare এ লাইভ করার গাইড (বাংলায়, ধাপে ধাপে)

কোনো server, SSH বা Docker লাগবে না। Cloudflare নিজেই চালাবে, HTTPS দেবে, আর GitHub এ নতুন কিছু push হলেই নিজে থেকে নতুন version live করবে।

**যা আগেই করা আছে (Claude করেছে):**
- ✅ আপনার Cloudflare account এ database বানানো: **woow-shop-db**, সব table সহ।
- ✅ পুরো code Cloudflare Workers এর জন্য তৈরি, আর demo mode এ পুরো flow test করা।

**আপনার কাজ শুধু ৪টা ধাপ।**

---

## ধাপ ১ — GitHub এ code রাখা

**সহজ উপায় (Claude দিয়ে):** claude.ai → **Settings → Connectors → GitHub** connect করুন। GitHub এ খালি **private** repo বানান (নাম: `woow-shop`), আর repo র নাম Claude কে বলুন। Claude নিজেই code push করে দেবে।

**নিজে করতে চাইলে (GitHub Desktop দিয়ে):**
1. **woow-shop-cloudflare.zip** আনজিপ করুন।
2. GitHub Desktop → **File → Add local repository** → ফোল্ডারটা বেছে নিন → **create a repository** → **Create repository**।
3. **Publish repository** → **Keep this code private ✅** → Publish।

---

## ধাপ ২ — Cloudflare এ GitHub repo জোড়া (একবারই)

1. **dash.cloudflare.com** → বাঁ দিকে **Workers & Pages**।
2. **Create application** → **Import a repository** → **Get started**।
3. GitHub account connect করুন (প্রথমবার permission চাইবে, **woow-shop** repo টা allow করুন)।
4. **woow-shop** repo বাছুন।
5. Project name অবশ্যই **`woow-shop`** রাখবেন (এই নামটাই code এ দেওয়া আছে)।
6. Build settings যেমন আছে তেমন রাখুন (Deploy command: `npx wrangler deploy`) → **Save and Deploy**।

২–৩ মিনিট পরে একটা লিংক পাবেন, যেমন **woow-shop.আপনার-নাম.workers.dev** ✅ খুলে দেখুন — shop চালু (demo mode)।

> এরপর থেকে GitHub এ যা push হবে, Cloudflare নিজেই কয়েক মিনিটে live করে দেবে।

---

## ধাপ ৩ — গোপন key বসানো (Secrets)

Cloudflare → **Workers & Pages → woow-shop → Settings → Variables and Secrets → Add**।
প্রতিটার **Type = Secret** দেবেন:

| নাম (Variable name) | কী দেবেন | কখন |
|---|---|---|
| `ADMIN_PASSWORD` | Admin panel এর শক্ত পাসওয়ার্ড (১২+ অক্ষর) | **এখনই** |
| `ZINC_API_KEY` | zinc.com থেকে `zn_...` key | Zinc account খোলার পর |
| `SSLCZ_STORE_ID` | SSLCommerz store id | SSLCommerz sandbox/live পাওয়ার পর |
| `SSLCZ_STORE_PASSWORD` | SSLCommerz store password | ঐ |

**Deploy** চাপুন। ⚠️ এগুলো chat এ কাউকে পাঠাবেন না — শুধু Cloudflare এ বসাবেন।

Admin panel: `https://...workers.dev/admin` → ইউজার `admin`, পাসওয়ার্ড যেটা দিলেন।

**Warehouse ঠিকানা আর bank details** (গোপন নয়) — Claude কে লিখে দিন, Claude `wrangler.jsonc` ফাইলে বসিয়ে push করে দেবে। অথবা নিজে GitHub এ `wrangler.jsonc` খুলে `WAREHOUSE_...` আর `BANK_...` লাইনগুলো পূরণ করে Commit করুন।

যখন আসল টাকা নেবেন: `wrangler.jsonc` এ `"SSLCZ_SANDBOX": "false"` করতে হবে (Claude কে বললেই হবে)।

---

## ধাপ ৪ — নিজের domain (shop.woowglobal.com)

শর্ত: woowglobal.com এর DNS Cloudflare এ থাকতে হবে।

1. **Workers & Pages → woow-shop → Settings → Domains & Routes → Add → Custom domain**।
2. লিখুন `shop.woowglobal.com` → **Add domain**।

কয়েক মিনিটে HTTPS সহ চালু ✅

তারপর এই দুটো লিংক বসাবেন:
- **Zinc** dashboard → Webhook URL: `https://shop.woowglobal.com/webhooks/zinc`
- **SSLCommerz** merchant panel → IPN URL: `https://shop.woowglobal.com/pay/ipn`

---

## প্রতিদিনের কাজ (Admin)

1. **Settings** → আজকের **ডলার রেট**, ফি, কেজি রেট, ফ্লাইটের দিন → Save।
2. **Orders** → order এ click:
   - Bank transfer হলে টাকা মিলিয়ে **✓ Confirm payment**।
   - Payment হলে **🛒 Buy with Zinc** → Zinc store থেকে কিনে Delaware warehouse এ পাঠাবে।
   - Store এর order নম্বর আর tracking প্রতি ৩০ মিনিটে নিজে থেকে আপডেট হয় (চাইলে **↻ Refresh**)।
   - Warehouse → flight → Dhaka → delivered — status বদলে **Update status**। Customer নিজের tracking page এ দেখবে।

---

### নতুন: Dashboard, Purchase sheet, US delivery ও tax
- **📊 Dashboard** — কতজন ভিজিটর, কে কোন শহর থেকে, কী সার্চ করছে, কতবার, cart, order, payment, আর Zinc এর balance + প্রতিদিন কত call ও কত খরচ।
- **🛒 Purchase sheet** — পেমেন্ট হওয়া প্রতিটা প্রোডাক্ট (লিংক, সাইজ, পরিমাণ, দাম)। কিনে ফেললে **✓ Bought** (store order নম্বর দিন), না পারলে **✕ Can't** (কারণ লিখুন) — GENI সাথে সাথে customer এর order page এ জানিয়ে দেবে। WhatsApp বাটনে মেসেজ রেডি। **Export CSV** দিয়ে Excel এ নিন।
- **Settings → US delivery & sales tax** — warehouse Delaware হলে tax ০%, New York হলে 8.875%। প্রতিটা store এর free delivery সীমা ($35) আর fee এখানে বদলানো যায়।
- **💰 Money** — কত টাকা এল, store থেকে আসলে কত দিয়ে কেনা হল (Purchase sheet এ "actual cost" দিলে), Zinc খরচ, অন্যান্য খরচ (air freight, customs, warehouse, staff, courier, marketing…), **Net profit**, আর কত shipping টাকা এখনো তোলা বাকি। খরচ যোগ করুন "Add expense" দিয়ে; CSV export করা যায়।
- **Dashboard এর উপরে Alerts** — ১ ঘণ্টার বেশি না-কেনা item, লোকসানের order, বাকি shipping টাকা, Zinc budget/balance কম।
- **✈️ WOOW flights (Settings)** — প্রতি মাসে ১০, ২০, ৩০ তারিখ (ছোট মাসে শেষ দিন)। Air schedule বদলালে **Move** (নতুন তারিখ + কারণ) বা **Cancel**, নতুন flight হলে **+ Add flight**। নতুন quote আর পুরনো order (যেগুলো এখনো flight এ ওঠেনি) — সবার delivery date সাথে সাথে বদলে যায়।
- **WOOW main admin থেকে auto update** — Cloudflare এ Secret **FLIGHTS_API_KEY** যোগ করুন। তারপর main admin থেকে `POST /api/flights` (header `x-woow-key: <key>`, body `{"flights":[{"date":"2026-10-22","no":"EK-585","note":"Airline change"},{"date":"2026-10-20","cancelled":true}]}`)। `GET /api/flights` এ সামনের flight তালিকা পাওয়া যায়।
- **Zinc cost control** — দৈনিক Zinc বাজেট ($3 default)। বাজেট শেষ হলে সার্চ আগের সেভ করা প্রোডাক্ট থেকে দেখাবে, নতুন খরচ হবে না।

### নিরাপত্তা, Sign in, ঠিকানা, Pickup
- **Sign in বাধ্যতামূলক** — দেখা/সার্চ সবাই পারে, কিন্তু cart, price request আর payment এর আগে customer কে mobile + password দিয়ে account খুলতে / sign in করতে হবে।
- **ঠিকানা** — checkout এ আগের সেভ করা ঠিকানা (Default আগে), নতুন ঠিকানা (📍 Use my current location দিয়ে verify, অথবা হাতে লেখা)। Google Maps দিয়ে verify চাইলে Cloudflare এ Secret **GOOGLE_MAPS_KEY** দিন (Google Cloud → Places API, শুধু আপনার domain এ সীমিত)।
- **ফ্রি Pickup** — WOOW Bangladesh Office, House #254, Road #03, Baridhara DOHS, Dhaka · ☎️ +88 09649-223322 · সকাল ১০টা – সন্ধ্যা ৬টা · শুক্রবার ও সরকারি ছুটিতে বন্ধ। Home delivery চার্জ Settings এ (এখন ৳0)।
- **Bot / খরচ নিয়ন্ত্রণ** — Settings → 🛡️ Bot & cost guard। ৩০ মিনিটে বেশি সার্চ/ভিউ বা বেশি paid lookup হলে সেই visitor আর Zinc খরচ করাতে পারবে না (শুধু সেভ করা প্রোডাক্ট দেখবে)। Dashboard → Security তে তালিকা, চাইলে Unblock।
- **লুকানো** — customer এর browser এ কোথাও supplier (Zinc) এর নাম নেই, কোড minify করা, error এ সাধারণ বার্তা।
- **আপনার account সুরক্ষা (নিজে করুন)** — Cloudflare, GitHub, Zinc, Gmail এ 2-Step verification চালু করুন; ADMIN_PASSWORD লম্বা ও আলাদা রাখুন; Zinc wallet এ অল্প টাকা রাখুন; চাইলে Cloudflare Zero Trust → Access দিয়ে /admin শুধু আপনার email এ সীমিত করুন; shop.woowglobal.com custom domain দিন।

## লাইভে যাওয়ার আগে চেকলিস্ট

- [ ] `ADMIN_PASSWORD` শক্ত
- [ ] SSLCommerz **sandbox** দিয়ে bKash / Nagad টেস্ট পেমেন্ট সফল
- [ ] Zinc দিয়ে ছোট একটা টেস্ট অর্ডার সফল
- [ ] Warehouse ঠিকানা, bank details সঠিক
- [ ] ডলার রেট, ফি, কেজি রেট ঠিক
- [ ] বাংলাদেশে টাকা নিয়ে USA তে কেনাকাটা (Bangladesh Bank FX নিয়ম, import/customs) — একজন বাংলাদেশি আইনজীবী / accountant এর সাথে নিশ্চিত করুন

কোথাও আটকালে screenshot পাঠান — কোন ধাপে, কী দেখাচ্ছে — Claude ঠিক করে দেবে। Cloudflare connect থাকায় Claude আপনার worker আর database চেক করতে পারে।

---

## Store logo বসানো

GitHub এ `public/logos/` folder এ store এর logo file রাখুন, নাম হবে store এর id দিয়ে:
`amazon.png`, `walmart.png`, `target.png`, `ebay.png`, `bestbuy.png`, `costco.png`, `macys.png`, `nike.png`, `sephora.png`, `ulta.png`, `iherb.png`, `carters.png`

File রাখলেই shop এর tile আর store page এ নিজে থেকে logo দেখাবে; না থাকলে অক্ষরের icon থাকবে। প্রতিটা কোম্পানির অফিসিয়াল brand / press kit থেকে logo নেবেন আর তাদের trademark নিয়ম মানবেন।
