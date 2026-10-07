// Zinc API v2: product search, product details, automatic ordering.
// Docs: https://www.zinc.com/docs  — key starts with "zn_" (Cloudflare secret ZINC_API_KEY)
// Without the key the shop runs in DEMO mode with sample products.
const BASE = 'https://api.zinc.com';
const RETAILERS = { nike: 'Nike', ulta: 'Ulta', iherb: 'iHerb', carters: "Carter's", sephora: 'Sephora', amazon: 'Amazon', walmart: 'Walmart', target: 'Target', bestbuy: 'Best Buy', costco: 'Costco', macys: "Macy's", homedepot: 'Home Depot', ebay: 'eBay' };
export const retailerName = (r) => RETAILERS[r] || r;
export const SEARCH_RETAILERS = ['amazon', 'walmart', 'target', 'bestbuy', 'macys'];
// Stores Zinc can't search/buy (e.g. Costco needs membership): customers paste the link, WOOW team quotes and buys by hand.
export const MANUAL_RETAILERS = { costco: 'Costco', nike: 'Nike', ulta: 'Ulta', iherb: 'iHerb', carters: "Carter's", sephora: 'Sephora' };
const CACHE_SEC = 30 * 60;

// Zinc charges per Data API call (search, product, offers ≈ $0.01). Every call is logged in D1 (zinc_calls)
// so the WOOW dashboard shows calls and cost, and a daily budget can stop paid searches.
const PAID = { search: 1, product: 1, offers: 1 };
function endpointOf(path, method) {
  if (path.startsWith('/search')) return 'search';
  if (/^\/products\/[^/?]+\/offers/.test(path)) return 'offers';
  if (path.startsWith('/products/')) return 'product';
  if (path.startsWith('/orders')) return method === 'POST' ? 'order' : 'order_status';
  return path.split(/[/?]/)[1] || 'other';
}
export async function logZinc(env, endpoint, { retailer = null, q = null, ok = 1, cost = null } = {}) {
  try {
    await env.DB.prepare('INSERT INTO zinc_calls (ts,endpoint,retailer,q,ok,cost_cents) VALUES (?,?,?,?,?,?)')
      .bind(Date.now(), endpoint, retailer, q ? String(q).slice(0, 120) : null, ok ? 1 : 0, cost ?? (PAID[endpoint] || 0)).run();
    _spent = null;
  } catch (e) { console.log('zinc log failed', e.message); }
}
async function zinc(env, path, opts = {}) {
  const ep = endpointOf(path, opts.method || 'GET');
  const qs = new URLSearchParams(path.split('?')[1] || '');
  const res = await fetch(BASE + path, { ...opts, headers: { Authorization: 'Bearer ' + env.ZINC_API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!['wallet', 'usage'].includes(ep)) await logZinc(env, ep, { retailer: qs.getAll('retailer').join(',') || null, q: qs.get('q'), ok: res.ok });
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.raw || res.statusText;
    throw new Error(`Zinc ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

// Daily budget: money spent on Zinc today (UTC), cached 30 s per worker.
let _spent = null;
export async function spentToday(env) {
  if (_spent && Date.now() - _spent.at < 30000) return _spent.cents;
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  let cents = 0;
  try { cents = (await env.DB.prepare('SELECT COALESCE(SUM(cost_cents),0) c FROM zinc_calls WHERE ts >= ?').bind(d.getTime()).first()).c; } catch {}
  _spent = { at: Date.now(), cents };
  return cents;
}
async function overBudget(env, budgetCents) { return budgetCents > 0 && (await spentToday(env)) >= budgetCents; }

export async function wallet(env) { return env.ZINC_API_KEY ? zinc(env, '/wallet/me') : null; }
export async function usage(env, days = 30) { return env.ZINC_API_KEY ? zinc(env, `/usage?window_days=${days}&recent=20`) : null; }

// Every product shown is saved, so the server (not the browser) decides the price at checkout.
export async function remember(env, list) {
  if (!list.length) return;
  const now = Date.now();
  await env.DB.batch(list.map((p) => env.DB.prepare('INSERT OR REPLACE INTO products (url,data,seen) VALUES (?,?,?)').bind(p.url, JSON.stringify(p), now)));
}
export async function recall(env, url, maxAgeMs = CACHE_SEC * 1000) {
  const r = await env.DB.prepare('SELECT data,seen FROM products WHERE url=?').bind(url).first();
  return r && Date.now() - r.seen < maxAgeMs ? JSON.parse(r.data) : null;
}

const normalize = (r) => ({
  url: r.url, retailer: r.retailer, store: retailerName(r.retailer), title: r.title, priceCents: Number(r.price) || 0,
  image: r.image || null, stars: r.stars ?? null, reviews: r.num_reviews ?? null, brand: r.brand ?? null, available: r.available ?? true,
  listPriceCents: Number(r.list_price ?? r.original_price ?? r.strikethrough_price ?? r.was_price ?? 0) || null,
  freeShipping: r.free_shipping ?? null,
});

// Search cost savers: 1) edge cache, 2) shared D1 cache for 6 h (same answer for every customer, every city),
// 3) over the daily budget → answer from products already saved (free).
const SEARCH_TTL = 6 * 3600e3;
const skey = (q, r) => `${r || 'all'}|${q.toLowerCase().replace(/\s+/g, ' ')}`;
async function localSearch(env, q, retailer) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 4);
  let sql = 'SELECT data FROM products WHERE 1=1', args = [];
  if (retailer && retailer !== 'all') { sql += " AND json_extract(data,'$.retailer')=?"; args.push(retailer); }
  words.forEach((w) => { sql += ' AND lower(data) LIKE ?'; args.push('%' + w.replace(/[%_]/g, '') + '%'); });
  const r = await env.DB.prepare(sql + ' ORDER BY seen DESC LIMIT 24').bind(...args).all();
  return r.results.map((x) => JSON.parse(x.data)).filter((p) => !p.demo);
}
export async function search(env, ctx, q, retailer, { budgetCents = 0, ttlMs = SEARCH_TTL } = {}) {
  q = (q || '').trim().slice(0, 120);
  if (!env.ZINC_API_KEY) { const L = demoSearch(q, retailer); ctx.waitUntil(remember(env, L)); return L; }
  const k = skey(q || 'best sellers', retailer);
  const cache = caches.default, key = new Request('https://cache.woow/search?k=' + encodeURIComponent(k));
  const hit = await cache.match(key);
  if (hit) { ctx.waitUntil(logZinc(env, 'search_saved', { retailer, q, cost: 0 })); return hit.json(); }
  const put = (L) => cache.put(key, new Response(JSON.stringify(L), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SEC}` } }));
  try {
    const row = await env.DB.prepare('SELECT data,ts FROM search_cache WHERE k=?').bind(k).first();
    if (row && Date.now() - row.ts < ttlMs) { const L = JSON.parse(row.data); ctx.waitUntil(Promise.all([put(L), logZinc(env, 'search_saved', { retailer, q, cost: 0 })])); return L; }
  } catch {}
  if (await overBudget(env, budgetCents)) {
    const L = await localSearch(env, q, retailer);
    ctx.waitUntil(logZinc(env, 'search_saved', { retailer, q, cost: 0 }));
    return L;
  }
  const params = new URLSearchParams({ q: q || 'best sellers', limit: '24' });
  if (retailer && retailer !== 'all') params.append('retailer', retailer); else SEARCH_RETAILERS.forEach((r) => params.append('retailer', r));
  const data = await zinc(env, '/search?' + params.toString());
  const L = (data.results || []).filter((r) => r.price > 0).map(normalize);
  ctx.waitUntil(Promise.all([remember(env, L), put(L),
    env.DB.prepare('INSERT OR REPLACE INTO search_cache (k,data,ts) VALUES (?,?,?)').bind(k, JSON.stringify(L), Date.now()).run().catch(() => {})]));
  return L;
}

export function storeFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const known = { 'costco.com': 'costco', 'nike.com': 'nike', 'ulta.com': 'ulta', 'iherb.com': 'iherb', 'carters.com': 'carters', 'sephora.com': 'sephora', 'amazon.com': 'amazon', 'walmart.com': 'walmart', 'target.com': 'target', 'bestbuy.com': 'bestbuy', 'macys.com': 'macys', 'ebay.com': 'ebay' };
    for (const [d, r] of Object.entries(known)) if (h === d || h.endsWith('.' + d)) return { retailer: r, store: retailerName(r) };
    return { retailer: 'other', store: h };
  } catch { return null; }
}

export function parseUrl(url) {
  try {
    const u = new URL(url), h = u.hostname.replace(/^www\./, ''); let m;
    if (/amazon\.com$/.test(h) && (m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i))) return { retailer: 'amazon', id: m[1], url: `https://www.amazon.com/dp/${m[1]}` };
    if (/walmart\.com$/.test(h) && (m = u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)/))) return { retailer: 'walmart', id: m[1], url: `https://www.walmart.com/ip/${m[1]}` };
    if (/target\.com$/.test(h) && (m = u.pathname.match(/A-(\d+)/))) return { retailer: 'target', id: m[1], url: u.origin + u.pathname };
    if (/macys\.com$/.test(h) && u.searchParams.get('ID')) return { retailer: 'macys', id: u.searchParams.get('ID'), url: u.origin + u.pathname + '?ID=' + u.searchParams.get('ID') };
    if (/costco\.com$/.test(h) && (m = u.pathname.match(/\.product\.(\d+)\.html/))) return { retailer: 'costco', id: m[1], url: u.origin + u.pathname };
    if (/bestbuy\.com$/.test(h) && (m = u.pathname.match(/\/([^/]+)\.p$/))) return { retailer: 'bestbuy', id: m[1], url: u.origin + u.pathname };
    if (/ebay\.com$/.test(h) && (m = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/))) return { retailer: 'ebay', id: m[1], url: `https://www.ebay.com/itm/${m[1]}` };
    return { retailer: null, id: null, url: u.toString() };
  } catch { return null; }
}

/** Product by URL (pasted link, or price check at checkout).
 *  live=true → ask Zinc for today's price right now (used when the customer presses Pay). */
export async function product(env, url, { fresh = false, live = false, liveFreshMs = 0 } = {}) {
  if (!env.ZINC_API_KEY) { const d = demoCatalog().find((p) => p.url === url) || (await recall(env, url, Infinity)); if (d) await remember(env, [d]); return d || null; }
  // Cost saver: a price checked a few minutes ago is still "live" — no second paid call.
  const known = await recall(env, url, live ? liveFreshMs : fresh ? 10 * 60 * 1000 : 6 * 3600e3);
  if (known) return known;
  const cached = await recall(env, url, Infinity);
  // Zinc can't read this product's page (e.g. some Macy's items → 422): use the saved search price, don't pay again for 24 h
  if (cached && cached.detailFailAt && Date.now() - cached.detailFailAt < 864e5) return { ...cached, priceChecked: 'search' };
  const pu = parseUrl(url);
  if (pu && MANUAL_RETAILERS[pu.retailer]) { if (cached && live) return cached; const e = new Error('manual'); e.manual = true; throw e; }
  if (!pu || !pu.retailer || !pu.id) {
    if (cached) return { ...cached, priceChecked: 'search' };
    throw new Error('This store link is not supported yet. Our team can buy it for you by hand.');
  }
  let d;
  try {
    d = await zinc(env, `/products/${encodeURIComponent(pu.id)}?retailer=${pu.retailer}&max_age=600`);
    if (d.status && d.status !== 'completed') throw new Error('Could not read this product right now. Try again in a minute.');
  } catch (e) {
    if (cached) { // keep the saved search price if Zinc can't read the product right now
      await env.DB.prepare('UPDATE products SET data=? WHERE url=?').bind(JSON.stringify({ ...cached, detailFailAt: Date.now() }), cached.url).run().catch(() => {});
      return { ...cached, priceChecked: 'search' };
    }
    throw e;
  }
  const livePrice = Number(d.price ?? d.price_cents ?? d.buybox_price ?? 0) || 0;
  const p = {
    ...(cached || {}),
    url: cached?.url || pu.url, retailer: pu.retailer, store: retailerName(pu.retailer),
    title: d.title || d.product_title || cached?.title || 'Product',
    priceCents: livePrice || cached?.priceCents || 0,
    image: d.main_image || (d.images && d.images[0]) || cached?.image || null,
    stars: d.stars ?? cached?.stars ?? null, reviews: d.review_count ?? d.num_reviews ?? cached?.reviews ?? null,
    kg: weightKg(d) ?? cached?.kg ?? null, available: d.available ?? true,
    priceChecked: livePrice ? 'live' : 'search',
  };
  await remember(env, [p]);
  return p;
}

/** US delivery cost store → WOOW warehouse from Zinc's live offers (shipping_options). Saved 24 h per product.
 *  Returns cents, or null when Zinc has no data (then the store rule in Admin → Settings is used). */
export const OFFER_RETAILERS = ['amazon', 'walmart', 'bestbuy'];
export async function shippingCents(env, p) {
  if (!p || !OFFER_RETAILERS.includes(p.retailer)) return null;
  if (Number.isFinite(p.shipCents) && Date.now() - (p.shipAt || 0) < 864e5) return p.shipCents;
  if (!env.ZINC_API_KEY) return null;
  const pu = parseUrl(p.url); if (!pu?.id) return null;
  try {
    const d = await zinc(env, `/products/${encodeURIComponent(pu.id)}/offers?retailer=${pu.retailer}`);
    const offers = (d.offers || []).filter((o) => o.available !== false && (!o.condition || /new/i.test(o.condition)));
    if (!offers.length) return null;
    const pick = offers.reduce((b, o) => (Math.abs((o.price || 0) - p.priceCents) < Math.abs((b.price || 0) - p.priceCents) ? o : b));
    const opts = (pick.shipping_options || []).map((x) => Number(x.price)).filter((x) => Number.isFinite(x));
    if (!opts.length) return null;
    const cents = Math.min(...opts);
    await env.DB.prepare('UPDATE products SET data=? WHERE url=?').bind(JSON.stringify({ ...p, shipCents: cents, shipAt: Date.now() }), p.url).run();
    return cents;
  } catch (e) { console.log('offers failed', e.message); return null; }
}

function weightKg(d) {
  const list = d.package_dimensions || d.dimensions || [];
  for (const x of Array.isArray(list) ? list : Object.values(list)) {
    const u = (x?.unit || '').toLowerCase();
    if (u.startsWith('pound') || u === 'lb' || u === 'lbs') return Math.max(0.1, x.amount * 0.4536);
    if (u.startsWith('ounce') || u === 'oz') return Math.max(0.1, x.amount * 0.02835);
    if (u === 'kg' || u.startsWith('kilogram')) return x.amount;
    if (u === 'g' || u.startsWith('gram')) return Math.max(0.1, x.amount / 1000);
  }
  return null;
}

export function warehouse(env) {
  const w = {
    first_name: env.WAREHOUSE_FIRST_NAME, last_name: env.WAREHOUSE_LAST_NAME, address_line1: env.WAREHOUSE_ADDRESS1, address_line2: env.WAREHOUSE_ADDRESS2,
    city: env.WAREHOUSE_CITY, state: env.WAREHOUSE_STATE, postal_code: env.WAREHOUSE_ZIP, phone_number: env.WAREHOUSE_PHONE,
  };
  return Object.fromEntries(Object.entries(w).filter(([, v]) => v));
}

/** One Zinc order per retailer, shipped to the WOOW US warehouse. max_price protects against price jumps. */
export async function placeOrder(env, { orderId, retailer, items, extraCents = 0 }) {
  const buffer = Number(env.ZINC_MAX_PRICE_BUFFER_PERCENT || 15);
  // max_price = products + US delivery + sales tax, plus a safety buffer
  const maxPrice = Math.ceil((items.reduce((a, it) => a + it.priceCents * it.qty, 0) + extraCents) * (1 + buffer / 100));
  if (!env.ZINC_API_KEY) return { id: `demo-${orderId}-${retailer}`, status: 'pending', max_price: maxPrice };
  const shipping_address = warehouse(env);
  if (!shipping_address.address_line1 || !shipping_address.postal_code) throw new Error('Add your warehouse address (WAREHOUSE_* variables) before placing real orders.');
  return zinc(env, '/orders', {
    method: 'POST',
    body: JSON.stringify({ products: items.map((it) => ({ url: it.url, quantity: it.qty })), shipping_address, max_price: maxPrice, idempotency_key: `${orderId}-${retailer}`.slice(0, 36), po_number: orderId }),
  });
}

export async function getZincOrder(env, id) {
  if (!env.ZINC_API_KEY || id.startsWith('demo-')) return { id, status: 'order_placed', merchant_order_ids: ['DEMO-' + id.slice(-12)], tracking_numbers: [] };
  return zinc(env, '/orders/' + encodeURIComponent(id));
}

// ───────── demo data ─────────
function emojiImg(e, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${bg}"/><text x="200" y="250" font-size="170" text-anchor="middle">${e}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
let _demo;
function demoCatalog() {
  if (_demo) return _demo;
  const D = [
    ['amazon', 'Wireless Noise Cancelling Headphones, 40h Battery', 8999, 0.6, '🎧', '#EEF1F6', 4.6, 12480],
    ['walmart', "Kids' Light-Up Sneakers, Hook and Loop", 2497, 0.5, '👟', '#FFF1E6', 4.4, 2031],
    ['amazon', 'Vitamin D3 5000 IU, 360 Softgels', 1349, 0.3, '💊', '#FFF8DB', 4.8, 98112],
    ['target', 'Smart Watch, AMOLED Display, Sport Band', 5900, 0.2, '⌚', '#EEF6F0', 4.3, 856],
    ['amazon', 'Hydrating Face Moisturizer, 3 oz', 1697, 0.2, '🧴', '#F3EEF8', 4.7, 41220],
    ['walmart', "Men's Slim Fit Jeans, Dark Wash", 1998, 0.6, '👖', '#EAF0F8', 4.2, 5610],
    ['bestbuy', '14" Laptop, 16GB RAM, 512GB SSD', 34900, 2.1, '💻', '#F0F0F3', 4.1, 312],
    ['walmart', 'Plush Teddy Bear, 18 inch', 1288, 0.4, '🧸', '#FBF0E8', 4.9, 7744],
    ['macys', "Women's Leather Crossbody Bag", 4999, 0.7, '👜', '#F8EEEE', 4.5, 1203],
    ['costco', 'Mixed Nuts, 2.5 lb Jar', 1599, 1.2, '🥜', '#FBF3E4', 4.7, 5520],
    ['target', 'Bluetooth Speaker, Waterproof', 3999, 0.6, '🔊', '#ECF3FA', 4.6, 3011],
    ['amazon', 'Running Shoes, Breathable Mesh', 6495, 0.8, '👟', '#EEF6F0', 4.5, 22014],
  ];
  _demo = D.map(([retailer, title, price, kg, e, bg, stars, reviews], i) => ({
    url: `https://demo.woow/${retailer}/${i + 1}`, retailer, store: retailerName(retailer), title, priceCents: price, kg, image: emojiImg(e, bg), stars, reviews, available: true, demo: true,
  }));
  return _demo;
}
function demoSearch(q, retailer) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const inStore = demoCatalog().filter((p) => !retailer || retailer === 'all' || p.retailer === retailer);
  const hit = inStore.filter((p) => !words.length || words.some((w) => p.title.toLowerCase().includes(w)));
  return hit.length ? hit : inStore; // demo: always show something
}


// ───────── price comparison across Amazon / Walmart / Target ─────────
// Cost saver: 1) answer from products we already saved (free), 2) otherwise ONE Zinc search
// covering all three stores ($0.01), 3) keep the answer 6 hours for every customer.
export const COMPARE_RETAILERS = ['amazon', 'walmart', 'target'];
const STOP = new Set('the a an and or for with of in on to by from pack count oz fl ct pcs piece pieces new size set'.split(' '));
const toks = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
export function similarity(a, b) {
  const A = new Set(toks(a.title)), B = new Set(toks(b.title));
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
  let s = inter / Math.min(A.size, B.size);
  const nums = (S) => [...S].filter((w) => /\d/.test(w));
  const na = nums(A), nb = nums(B);
  if (na.length && nb.length && !na.some((n) => nb.includes(n))) s *= 0.5; // different size / model number
  if (a.brand && b.brand && a.brand.toLowerCase() !== b.brand.toLowerCase()) s *= 0.6;
  return Math.round(s * 100) / 100;
}
function bestPerStore(base, list, min = 0.55) {
  const best = {};
  for (const p of list) {
    if (!COMPARE_RETAILERS.includes(p.retailer) || p.retailer === base.retailer || !p.priceCents) continue;
    const sc = similarity(base, p);
    if (sc >= min && (!best[p.retailer] || sc > best[p.retailer].score)) best[p.retailer] = { ...p, score: sc };
  }
  return Object.values(best);
}
export async function compare(env, ctx, url) {
  const base = await recall(env, url, Infinity);
  if (!base) return { base: null, offers: [], source: 'none' };
  const cache = caches.default, key = new Request('https://cache.woow/compare?u=' + encodeURIComponent(url));
  const hit = await cache.match(key); if (hit) { if (env.ZINC_API_KEY) ctx.waitUntil(logZinc(env, 'compare_saved', { retailer: base.retailer, cost: 0 })); return { ...(await hit.json()), source: 'cache' }; }
  // 1) free: products we already saved in the last 6 hours
  const since = Date.now() - 6 * 3600e3;
  const rows = (await env.DB.prepare("SELECT data FROM products WHERE seen > ? AND url != ? AND json_extract(data,'$.retailer') IN ('amazon','walmart','target') ORDER BY seen DESC LIMIT 800").bind(since, url).all()).results;
  let offers = bestPerStore(base, rows.map((r) => JSON.parse(r.data)));
  let source = 'saved';
  const missing = COMPARE_RETAILERS.filter((r) => r !== base.retailer && !offers.some((o) => o.retailer === r));
  if (env.ZINC_API_KEY && !missing.length) ctx.waitUntil(logZinc(env, 'compare_saved', { retailer: base.retailer, cost: 0 }));
  // 2) one Zinc search for the stores still missing
  if (missing.length && env.ZINC_API_KEY) {
    const q = [base.brand, ...toks(base.title).slice(0, 7)].filter(Boolean).join(' ');
    const params = new URLSearchParams({ q, limit: '15' }); missing.forEach((r) => params.append('retailer', r));
    try {
      const data = await zinc(env, '/search?' + params.toString());
      const L = (data.results || []).filter((r) => r.price > 0).map(normalize);
      ctx.waitUntil(remember(env, L));
      offers = offers.concat(bestPerStore(base, L).filter((o) => missing.includes(o.retailer)));
      source = 'zinc';
    } catch (e) { console.log('compare search failed', e.message); }
  }
  if (!env.ZINC_API_KEY && !offers.length) { // demo: show the idea with sample prices
    offers = COMPARE_RETAILERS.filter((r) => r !== base.retailer).map((r, i) => ({ ...base, url: base.url + '#' + r, retailer: r, store: retailerName(r), priceCents: Math.round(base.priceCents * (i ? 1.06 : 0.94)), score: 0.9, demo: true }));
    await remember(env, offers);
  }
  const out = { base, offers: offers.sort((a, b) => a.priceCents - b.priceCents) };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' } })));
  return { ...out, source };
}
