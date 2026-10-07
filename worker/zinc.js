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

async function zinc(env, path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { Authorization: 'Bearer ' + env.ZINC_API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.raw || res.statusText;
    throw new Error(`Zinc ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

// Every product shown is saved, so the server (not the browser) decides the price at checkout.
export async function remember(env, list) {
  if (!list.length) return;
  const now = Date.now();
  await env.DB.batch(list.map((p) => env.DB.prepare('INSERT OR REPLACE INTO products (url,data,seen) VALUES (?,?,?)').bind(p.url, JSON.stringify(p), now)));
}
async function recall(env, url, maxAgeMs = CACHE_SEC * 1000) {
  const r = await env.DB.prepare('SELECT data,seen FROM products WHERE url=?').bind(url).first();
  return r && Date.now() - r.seen < maxAgeMs ? JSON.parse(r.data) : null;
}

const normalize = (r) => ({
  url: r.url, retailer: r.retailer, store: retailerName(r.retailer), title: r.title, priceCents: Number(r.price) || 0,
  image: r.image || null, stars: r.stars ?? null, reviews: r.num_reviews ?? null, brand: r.brand ?? null, available: r.available ?? true,
  listPriceCents: Number(r.list_price ?? r.original_price ?? r.strikethrough_price ?? r.was_price ?? 0) || null,
  freeShipping: r.free_shipping ?? null,
});

export async function search(env, ctx, q, retailer) {
  q = (q || '').trim().slice(0, 120);
  if (!env.ZINC_API_KEY) { const L = demoSearch(q, retailer); ctx.waitUntil(remember(env, L)); return L; }
  const cache = caches.default;
  const key = new Request(`https://cache.woow/search?r=${retailer || 'all'}&q=${encodeURIComponent(q.toLowerCase())}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const params = new URLSearchParams({ q: q || 'best sellers', limit: '24' });
  if (retailer && retailer !== 'all') params.append('retailer', retailer); else SEARCH_RETAILERS.forEach((r) => params.append('retailer', r));
  const data = await zinc(env, '/search?' + params.toString());
  const L = (data.results || []).filter((r) => r.price > 0).map(normalize);
  ctx.waitUntil(Promise.all([remember(env, L), cache.put(key, new Response(JSON.stringify(L), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SEC}` } }))]));
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
export async function product(env, url, { fresh = false, live = false } = {}) {
  if (!env.ZINC_API_KEY) { const d = demoCatalog().find((p) => p.url === url) || (await recall(env, url, Infinity)); if (d) await remember(env, [d]); return d || null; }
  if (!live) {
    const known = await recall(env, url, fresh ? 10 * 60 * 1000 : CACHE_SEC * 1000 * 4);
    if (known) return known;
  }
  const cached = await recall(env, url, Infinity);
  const pu = parseUrl(url);
  if (pu && MANUAL_RETAILERS[pu.retailer]) { if (cached && live) return cached; const e = new Error('manual'); e.manual = true; throw e; }
  if (!pu || !pu.retailer || !pu.id) {
    if (cached && live) return { ...cached, priceChecked: 'search' };
    throw new Error('This store link is not supported yet. Our team can buy it for you by hand.');
  }
  let d;
  try {
    d = await zinc(env, `/products/${encodeURIComponent(pu.id)}?retailer=${pu.retailer}&max_age=600`);
    if (d.status && d.status !== 'completed') throw new Error('Could not read this product right now. Try again in a minute.');
  } catch (e) {
    if (cached && live) return { ...cached, priceChecked: 'search' }; // keep the search price if the live check fails
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
export async function placeOrder(env, { orderId, retailer, items }) {
  const buffer = Number(env.ZINC_MAX_PRICE_BUFFER_PERCENT || 15);
  const maxPrice = Math.ceil(items.reduce((a, it) => a + it.priceCents * it.qty, 0) * (1 + buffer / 100));
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
