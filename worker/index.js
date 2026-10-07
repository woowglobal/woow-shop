// WOOW Shop on Cloudflare Workers — API, payments, Zinc purchasing, admin.
// Website files (public/) are served by Cloudflare Static Assets.
import { getPricing, savePricing, quote, deliveryPlan, taxRate, shipRule, upcomingFlights, cleanFlights, refreshPlan } from './pricing.js';
import * as zinc from './zinc.js';
import * as ssl from './sslcommerz.js';

const STATUS = {
  quote_requested: 'WOOW is checking the price', awaiting_payment: 'Waiting for payment', bank_review: 'Checking your bank transfer', paid: 'Paid — GENI will buy soon',
  purchasing: 'GENI is buying from the store', purchased: 'Bought — on the way to our US warehouse',
  at_warehouse: 'At WOOW US warehouse', in_flight: 'On the WOOW flight', in_dhaka: 'In Dhaka, clearing customs',
  delivered: 'Delivered', cancelled: 'Cancelled', problem: 'Needs attention',
};
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

// ───────── helpers ─────────
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const redirect = (url) => new Response(null, { status: 302, headers: { Location: url } });
const nowIso = () => new Date().toISOString();
const J = (s) => (s ? JSON.parse(s) : null);

function bdPhone(p) {
  let s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+880')) s = '0' + s.slice(4); else if (s.startsWith('880')) s = '0' + s.slice(3);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}
async function body(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return req.json().catch(() => ({}));
  if (ct.includes('form')) return Object.fromEntries(await req.formData());
  return {};
}

// best-effort rate limit per Cloudflare location (protects your Zinc wallet)
const hits = new Map();
function limited(req, key, max, perMs) {
  const k = (req.headers.get('cf-connecting-ip') || '') + key, t = Date.now();
  const h = (hits.get(k) || []).filter((x) => t - x < perMs);
  h.push(t); hits.set(k, h);
  return h.length > max;
}

// ───────── analytics: who searches what, from where (Cloudflare gives country / region / city) ─────────
const TRACK_TYPES = new Set(['visit', 'search', 'view', 'compare', 'cart', 'checkout', 'link', 'quote', 'order', 'paid', 'recent']);
const zoneOf = (req) => { const c = req?.cf || {}; return { country: c.country || null, region: c.region || null, city: c.city || null }; };
async function track(env, req, type, f = {}) {
  if (!TRACK_TYPES.has(type)) return;
  const z = f.zone || zoneOf(req), sid = String(f.sid || req?.headers.get('x-sid') || '').slice(0, 40) || null;
  try {
    await env.DB.prepare('INSERT INTO track (ts,sid,type,country,region,city,store,q,url,price_cents,order_id,extra) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(Date.now(), sid, type, z.country, z.region, z.city, f.store || null, f.q ? String(f.q).slice(0, 160) : null, f.url ? String(f.url).slice(0, 600) : null,
        Number.isFinite(f.price) ? Math.round(f.price) : null, f.order || null, f.extra ? JSON.stringify(f.extra).slice(0, 500) : null).run();
  } catch (e) { console.log('track failed', e.message); }
}

// ───────── database ─────────
const row2order = (r) => r && { ...r, customer: J(r.customer), items: J(r.items), totals: J(r.totals), payment: J(r.payment), zinc: J(r.zinc), delivery: J(r.delivery) };
const getOrder = async (env, id) => row2order(await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first());
const addEvent = (env, id, text) => env.DB.prepare('INSERT INTO events (order_id,at,text) VALUES (?,?,?)').bind(id, nowIso(), text).run();
const getEvents = async (env, id) => (await env.DB.prepare('SELECT at,text FROM events WHERE order_id=? ORDER BY id').bind(id).all()).results;
async function updateOrder(env, id, patch) {
  const cols = Object.keys(patch);
  const vals = cols.map((c) => (patch[c] !== null && typeof patch[c] === 'object' ? JSON.stringify(patch[c]) : patch[c]));
  await env.DB.prepare(`UPDATE orders SET ${cols.map((c) => c + '=?').join(',')}, updated_at=? WHERE id=?`).bind(...vals, nowIso(), id).run();
  return getOrder(env, id);
}
async function newOrderId(env) {
  for (;;) {
    const id = 'WB-' + (100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    if (!(await env.DB.prepare('SELECT 1 FROM orders WHERE id=?').bind(id).first())) return id;
  }
}

function publicOrder(o, events) {
  return {
    id: o.id, created_at: o.created_at, status: o.status, statusText: STATUS[o.status] || o.status, plan: o.plan, method: o.method,
    amount_due: o.amount_due, amount_paid: o.amount_paid, totals: o.totals, delivery: o.delivery,
    customer: { name: o.customer.name, city: o.customer.city },
    items: o.items.map((i) => ({ title: i.title, store: i.store, qty: i.qty, image: i.image, lineBdt: i.lineBdt, buy: i.buy?.status || null })),
    merchantOrders: (o.zinc?.groups || []).flatMap((g) => g.merchant_order_ids || []), events,
  };
}

// ───────── business logic ─────────
async function markPaid(env, ctx, order, amount, info) {
  if (order.amount_paid >= order.amount_due && !['awaiting_payment', 'bank_review'].includes(order.status)) return order;
  const paid = order.amount_paid + Math.round(amount);
  const o = await updateOrder(env, order.id, { amount_paid: paid, status: paid >= order.amount_due ? 'paid' : order.status, payment: { ...(order.payment || {}), ...info, at: nowIso() } });
  await addEvent(env, order.id, `Payment received: ৳${Math.round(amount).toLocaleString('en-US')} (${info.method || order.method})`);
  ctx.waitUntil(track(env, null, 'paid', { sid: order.customer?.sid, zone: order.customer?.zone || {}, order: order.id, price: Math.round(amount), extra: { method: info.method || order.method } }));
  if (o.status === 'paid') await addEvent(env, order.id, 'GENI has your order — our purchase team is buying it now');
  if (o.status === 'paid' && env.AUTO_PLACE_ORDERS === 'true') ctx.waitUntil(placeWithZinc(env, o).catch((e) => addEvent(env, o.id, 'Auto purchase failed: ' + e.message)));
  return o;
}

async function placeWithZinc(env, order) {
  const groups = {};
  for (const it of order.items) (groups[it.retailer] ||= []).push(it);
  const results = [];
  for (const [retailer, items] of Object.entries(groups)) {
    if (items.every((i) => i.manual) || zinc.MANUAL_RETAILERS[retailer] || retailer === 'other') {
      results.push({ retailer, id: null, status: 'buy_by_hand', merchant_order_ids: [], tracking: [] });
      await addEvent(env, order.id, `${zinc.retailerName(retailer)}: buy by hand (not available on Zinc)`);
      continue;
    }
    const done = order.zinc?.groups?.find((g) => g.retailer === retailer && g.id && !['order_failed', 'cancelled'].includes(g.status));
    if (done) { results.push(done); continue; }
    const st = (order.totals?.stores || []).find((x) => x.retailer === retailer);
    const shipC = Math.round((st?.shipUsd || 0) * 100), subC = items.reduce((a, it) => a + it.priceCents * it.qty, 0);
    const r = await zinc.placeOrder(env, { orderId: order.id, retailer, items, extraCents: shipC + Math.round((subC + shipC) * (order.totals?.taxRate || 0) / 100) });
    results.push({ retailer, id: r.id, status: r.status, max_price: r.max_price, merchant_order_ids: [], tracking: [] });
    await addEvent(env, order.id, `Purchase sent to ${zinc.retailerName(retailer)} via Zinc (${r.id})`);
  }
  return updateOrder(env, order.id, { zinc: { groups: results }, status: 'purchasing' });
}

async function refreshZinc(env, order) {
  if (!order.zinc?.groups?.length) return order;
  const groups = [];
  for (const g of order.zinc.groups) {
    if (!g.id) { groups.push(g); continue; }
    try {
      const z = await zinc.getZincOrder(env, g.id);
      const tracking = (z.tracking_numbers || []).map((t) => ({ carrier: t.carrier, number: t.number || t.tracking_number, status: t.status }));
      if (z.status !== g.status) await addEvent(env, order.id, `${zinc.retailerName(g.retailer)}: ${z.status}`);
      groups.push({ ...g, status: z.status, merchant_order_ids: z.merchant_order_ids || g.merchant_order_ids || [], tracking, error: undefined });
    } catch (e) { groups.push({ ...g, error: e.message }); }
  }
  let status = order.status;
  if (status === 'purchasing' && groups.every((g) => ['order_placed', 'buy_by_hand'].includes(g.status)) && groups.some((g) => g.status === 'order_placed')) status = 'purchased';
  if (groups.some((g) => ['order_failed', 'cancelled', 'cancelled_by_retailer'].includes(g.status))) status = 'problem';
  return updateOrder(env, order.id, { zinc: { groups }, status });
}

async function priceItems(env, raw, { live = false, liveFreshMs = 0 } = {}) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw new Error('Your cart is empty or too big.');
  const items = [];
  for (const r of raw) {
    const qty = Math.max(1, Math.min(9, parseInt(r.qty, 10) || 1));
    const p = await zinc.product(env, String(r.url || ''), { live, liveFreshMs });
    if (p && p.available === false) throw new Error(`“${p.title.slice(0, 60)}” is out of stock at ${p.store} right now. Please remove it.`);
    if (!p || !p.priceCents) throw new Error('Price not available for one item. Please remove it and try again.');
    const it = { url: p.url, retailer: p.retailer, store: p.store, title: p.title, image: p.image, priceCents: p.priceCents, kg: p.kg || null, qty, option: String(r.option || '').slice(0, 60) };
    if (Number.isFinite(p.shipCents) && Date.now() - (p.shipAt || 0) < 864e5) it.shipCents = p.shipCents;
    items.push(it);
  }
  return items;
}
// Real US delivery cost from Zinc offers — only for stores still under their free-delivery limit,
// at most 3 lookups per cart, and saved 24 h (so Pay doesn't pay again).
async function addUsShipping(env, items, pr) {
  const sub = {};
  items.forEach((i) => { sub[i.retailer] = (sub[i.retailer] || 0) + i.priceCents * i.qty; });
  let n = 0;
  for (const it of items) {
    if (Number.isFinite(it.shipCents) || n >= 3 || !zinc.OFFER_RETAILERS.includes(it.retailer)) continue;
    if (sub[it.retailer] >= shipRule(pr, it.retailer).freeOver * 100) continue;
    n++;
    const rec = await zinc.recall(env, it.url, Infinity);
    const c = await zinc.shippingCents(env, rec || it);
    if (Number.isFinite(c)) it.shipCents = c;
  }
  return items;
}

// ───────── admin auth ─────────
async function isAdmin(req, env) {
  const [type, val] = (req.headers.get('authorization') || '').split(' ');
  if (type !== 'Basic' || !val || !env.ADMIN_PASSWORD) return false;
  let u = '', p = '';
  try { [u, p] = atob(val).split(':'); } catch { return false; }
  const enc = new TextEncoder();
  const same = (a, b) => { const x = enc.encode(a), y = enc.encode(b); return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y); };
  return same(u, env.ADMIN_USER || "admin") && same(p, env.ADMIN_PASSWORD);
}
const askLogin = (env) => new Response(env.ADMIN_PASSWORD ? 'Login required' : 'Set the ADMIN_PASSWORD secret in Cloudflare first', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="WOOW Admin"' } });

// ───────── routes ─────────
async function handle(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname, m = req.method, origin = env.PUBLIC_URL || url.origin;

  if (path === '/admin' || path === '/admin.html' || path.startsWith('/api/admin')) {
    if (!(await isAdmin(req, env))) return askLogin(env);
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(new Request(url.origin + '/admin', req));
    return adminApi(req, env, ctx, path, m);
  }

  if (path === '/api/config') {
    const p = await getPricing(env.DB);
    return json({
      demo: { zinc: !env.ZINC_API_KEY, payments: !ssl.paymentsLive(env) }, rate: p.rate, feePercent: p.feePercent, minFee: p.minFee, kgRate: p.kgRate,
      defaultKg: p.defaultKg, packagingPercent: p.packagingPercent, usShipping: p.usShipping, warehouseState: p.warehouseState, taxRate: taxRate(p), brokerageList: p.brokerageList, whatsapp: env.WHATSAPP_NUMBER || '8801816369701', rateLockMinutes: p.rateLockMinutes, flights: upcomingFlights(new Date(Date.now() + 6 * 3600e3), p, 12), transitDays: p.transitDays, dhakaDaysAfterFlight: p.dhakaDaysAfterFlight,
      stores: zinc.SEARCH_RETAILERS.map((r) => ({ id: r, name: zinc.retailerName(r) })),
      bank: { name: env.BANK_ACCOUNT_NAME || 'WOOW Global (BD)', number: env.BANK_ACCOUNT_NUMBER || '—', branch: env.BANK_NAME_BRANCH || '—' },
    });
  }

  if (path === '/api/search') {
    if (limited(req, 's', 30, 60000)) return bad('Too many searches, please wait a moment.', 429);
    const q = url.searchParams.get('q') || '', st = url.searchParams.get('store') || 'all', pr = await getPricing(env.DB);
    // home/store rails (same words every day) are shared for 24 h; customer searches for 6 h
    const results = await zinc.search(env, ctx, q, st, { budgetCents: pr.zincDailyBudgetCents, ttlMs: url.searchParams.get('rail') === '1' ? 864e5 : 6 * 3600e3 });
    if (url.searchParams.get('t') !== '0') ctx.waitUntil(track(env, req, 'search', { q: q || '(popular)', store: st, extra: { n: results.length } }));
    return json({ results });
  }

  if (path === '/api/compare') {
    if (limited(req, 'c', 40, 60000)) return bad('Too many requests, please wait a moment.', 429);
    const d = await zinc.compare(env, ctx, url.searchParams.get('url') || '');
    ctx.waitUntil(track(env, req, 'compare', { url: d.base?.url, store: d.base?.retailer, extra: { offers: d.offers.length, source: d.source } }));
    return json(d);
  }

  if (path === '/api/link' && m === 'POST') {
    if (limited(req, 'l', 20, 60000)) return bad('Too many requests, please wait a moment.', 429);
    const u = String((await body(req)).url || '').trim();
    const where = zinc.storeFromUrl(u);
    if (!where) return bad('Please paste a full product link (starting with https://).');
    try {
      const p = await zinc.product(env, u, { fresh: true });
      if (p && p.priceCents) { ctx.waitUntil(track(env, req, 'link', { url: p.url, store: p.retailer, q: p.title, price: p.priceCents })); return json({ product: p }); }
    } catch (e) { if (!e.manual) console.log('link lookup failed', e.message); }
    // Not available automatically (e.g. Costco): offer a price quote from the WOOW team.
    ctx.waitUntil(track(env, req, 'link', { url: u, store: where.retailer, extra: { manual: true } }));
    return json({ manual: true, url: u, retailer: where.retailer, store: where.store });
  }

  if (path === '/api/quote' && m === 'POST') {
    const b = await body(req), pr = await getPricing(env.DB), items = await priceItems(env, b.items);
    if (b.ship) { await addUsShipping(env, items, pr); ctx.waitUntil(track(env, req, 'checkout', { price: items.reduce((a, i) => a + i.priceCents * i.qty, 0), extra: { items: items.length } })); }
    return json({ quote: quote(items, pr), delivery: deliveryPlan(items.map((i) => i.retailer), pr) });
  }

  if (path === '/api/orders' && m === 'POST') {
    if (limited(req, 'o', 10, 60000)) return bad('Too many orders, please wait a moment.', 429);
    const b = await body(req), c = b.customer || {}, plan = b.plan || 'full', method = b.method || 'bkash', phone = bdPhone(c.phone);
    if (!c.name || String(c.name).trim().length < 2) return bad('Please enter your name.');
    if (!phone) return bad('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
    if (!c.address || String(c.address).trim().length < 6) return bad('Please enter your delivery address.');
    if (!['full', 'split'].includes(plan)) return bad('Invalid payment plan.');
    if (!['bkash', 'nagad', 'card', 'bank'].includes(method)) return bad('Invalid payment method.');
    // Fresh price check from the store right now, before taking any money.
    const pr = await getPricing(env.DB), items = await priceItems(env, b.items, { live: true, liveFreshMs: (pr.liveFreshMinutes ?? 15) * 60000 });
    await addUsShipping(env, items, pr);
    const q = quote(items, pr), due = plan === 'full' ? q.total : q.payNowSplit;
    const expected = Number(b.expectedTotal);
    if (expected && Math.abs(expected - q.total) >= 1) {
      return json({ error: 'price_changed', message: `The store price changed. New total: ৳${q.total.toLocaleString('en-US')} (was ৳${Math.round(expected).toLocaleString('en-US')}). Please check and press Pay again.`, quote: q, delivery: deliveryPlan(items.map((i) => i.retailer), pr) }, 409);
    }
    const id = await newOrderId(env), t = nowIso();
    const customer = { name: String(c.name).trim().slice(0, 80), phone, email: String(c.email || '').trim().slice(0, 120), address: String(c.address).trim().slice(0, 300), city: String(c.city || 'Dhaka').trim().slice(0, 60), zone: zoneOf(req), sid: String(req.headers.get('x-sid') || '').slice(0, 40) };
    ctx.waitUntil(track(env, req, 'order', { order: id, price: q.total, extra: { items: items.length, plan, method, stores: [...new Set(items.map((i) => i.retailer))] } }));
    await env.DB.prepare('INSERT INTO orders (id,created_at,updated_at,status,phone,customer,items,totals,plan,method,amount_due,delivery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, t, t, 'awaiting_payment', phone, JSON.stringify(customer), JSON.stringify(q.lines), JSON.stringify(q), plan, method, due, JSON.stringify(deliveryPlan(items.map((i) => i.retailer), pr))).run();
    await addEvent(env, id, 'Order created');
    if (method === 'bank') return json({ orderId: id, next: { type: 'bank', amount: due } });
    if (!ssl.paymentsLive(env)) return json({ orderId: id, next: { type: 'redirect', url: `/pay-demo?order=${id}&phone=${phone}&method=${method}` } });
    const order = await getOrder(env, id);
    const p = await ssl.startPayment(env, origin, order, due);
    await updateOrder(env, id, { payment: { tranId: p.tranId, method } });
    return json({ orderId: id, next: { type: 'redirect', url: p.url } });
  }

  // Customer asks WOOW for a price (stores we can't price automatically, e.g. Costco).
  if (path === '/api/quote-request' && m === 'POST') {
    if (limited(req, 'q', 6, 60000)) return bad('Too many requests, please wait a moment.', 429);
    const b = await body(req), c = b.customer || {}, phone = bdPhone(c.phone), it = b.item || {};
    if (!c.name || String(c.name).trim().length < 2) return bad('Please enter your name.');
    if (!phone) return bad('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
    if (!c.address || String(c.address).trim().length < 6) return bad('Please enter your delivery address.');
    const where = zinc.storeFromUrl(String(it.url || ''));
    if (!where) return bad('Please paste a full product link.');
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    const usd = Math.max(0, Math.min(20000, Number(it.usd) || 0));
    const item = { url: String(it.url).slice(0, 600), retailer: where.retailer, store: where.store, title: String(it.title || 'Product from ' + where.store).trim().slice(0, 160), image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#F5F5F7"/><text x="100" y="125" font-size="80" text-anchor="middle">🛍️</text></svg>'), priceCents: Math.round(usd * 100), kg: null, qty, option: String(it.option || '').slice(0, 60), manual: true, customerNote: String(it.note || '').slice(0, 300) };
    const pr = await getPricing(env.DB), q = quote([item], pr), id = await newOrderId(env), t = nowIso();
    const customer = { name: String(c.name).trim().slice(0, 80), phone, email: String(c.email || '').trim().slice(0, 120), address: String(c.address).trim().slice(0, 300), city: String(c.city || 'Dhaka').trim().slice(0, 60) };
    await env.DB.prepare('INSERT INTO orders (id,created_at,updated_at,status,phone,customer,items,totals,plan,method,amount_due,delivery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, t, t, 'quote_requested', phone, JSON.stringify(customer), JSON.stringify(q.lines), JSON.stringify(q), 'full', 'bkash', 0, JSON.stringify(deliveryPlan([where.retailer], pr))).run();
    await addEvent(env, id, `Price quote requested (${where.store})`);
    ctx.waitUntil(track(env, req, 'quote', { order: id, url: item.url, store: where.retailer, q: item.title, price: item.priceCents }));
    return json({ orderId: id, phone });
  }

  // WOOW flight schedule. GET = next flights (public). POST = WOOW main admin pushes the schedule
  // (header "x-woow-key: <FLIGHTS_API_KEY secret>"; body { flights:[{date:'2026-10-20', no, note, cancelled}], monthDays?:[10,20,30], replace?:true }).
  if (path === '/api/flights') {
    if (m === 'POST') {
      const k = req.headers.get('x-woow-key') || '';
      if (!env.FLIGHTS_API_KEY || k.length !== env.FLIGHTS_API_KEY.length || !crypto.subtle.timingSafeEqual(new TextEncoder().encode(k), new TextEncoder().encode(env.FLIGHTS_API_KEY))) return bad('Not allowed', 401);
      const b = await body(req), cur = await getPricing(env.DB);
      const list = Array.isArray(b.flights) ? (b.replace ? b.flights : [...(cur.flights || []).filter((f) => !b.flights.some((x) => x.date === f.date)), ...b.flights]) : cur.flights;
      const p = await savePricing(env.DB, { flights: cleanFlights(list), ...(Array.isArray(b.monthDays) ? { flightMonthDays: b.monthDays } : {}) });
      return json({ ok: true, upcoming: upcomingFlights(new Date(Date.now() + 6 * 3600e3), p, 10) });
    }
    return json({ upcoming: upcomingFlights(new Date(Date.now() + 6 * 3600e3), await getPricing(env.DB), 10) });
  }

  // Home feed: what other customers searched, viewed and bought — built from WOOW's own data, so it costs no Zinc calls.
  if (path === '/api/feed') {
    const cache = caches.default, key = new Request(url.origin + '/__feed?v=1');
    const hit = await cache.match(key); if (hit) return hit;
    const d = await feed(env);
    const res = new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }

  // Browser beacons: product views, add to cart, recently-viewed clicks (no personal data).
  if (path === '/api/t' && m === 'POST') {
    if (limited(req, 't', 120, 60000)) return json({ ok: false });
    const b = await body(req);
    if (['visit', 'view', 'cart', 'recent'].includes(b.type)) ctx.waitUntil(track(env, req, b.type, { sid: b.sid, store: b.store, q: b.title, url: b.url, price: Number(b.price) }));
    return json({ ok: true });
  }

  let mm;
  // Pay an existing order (after a quote, or a payment that didn't finish).
  if ((mm = path.match(/^\/api\/orders\/([A-Z0-9-]+)\/pay$/)) && m === 'POST') {
    const b = await body(req), o = await getOrder(env, mm[1]);
    if (!o || o.phone !== bdPhone(b.phone)) return bad('Order not found', 404);
    if (o.status !== 'awaiting_payment' || o.amount_due <= o.amount_paid) return bad('This order is not waiting for payment.');
    const method = ['bkash', 'nagad', 'card', 'bank'].includes(b.method) ? b.method : 'bkash';
    await updateOrder(env, o.id, { method });
    const due = o.amount_due - o.amount_paid;
    if (method === 'bank') return json({ next: { type: 'bank' } });
    if (!ssl.paymentsLive(env)) return json({ next: { type: 'redirect', url: `/pay-demo?order=${o.id}&phone=${o.phone}&method=${method}` } });
    const p = await ssl.startPayment(env, origin, o, due);
    await updateOrder(env, o.id, { payment: { ...(o.payment || {}), tranId: p.tranId, method } });
    return json({ next: { type: 'redirect', url: p.url } });
  }
  if ((mm = path.match(/^\/api\/orders\/([A-Z0-9-]+)\/bank$/)) && m === 'POST') {
    const b = await body(req), o = await getOrder(env, mm[1]);
    if (!o || o.phone !== bdPhone(b.phone)) return bad('Order not found', 404);
    const ref = String(b.reference || '').trim().slice(0, 80);
    if (ref.length < 3) return bad('Please enter the transfer reference or transaction ID.');
    await updateOrder(env, o.id, { status: 'bank_review', payment: { method: 'bank', reference: ref, submitted: nowIso() } });
    await addEvent(env, o.id, 'Bank transfer submitted, ref ' + ref);
    return json({ ok: true });
  }

  // Customer's order history: proven by one order number + the same mobile.
  if (path === '/api/my-orders') {
    const phone = bdPhone(url.searchParams.get('phone')), id = String(url.searchParams.get('id') || '').toUpperCase();
    const o = phone && (await env.DB.prepare('SELECT id FROM orders WHERE id=? AND phone=?').bind(id, phone).first());
    if (!o) return bad('Order not found', 404);
    const r = await env.DB.prepare('SELECT id,created_at,status,amount_due,amount_paid,items FROM orders WHERE phone=? ORDER BY created_at DESC LIMIT 30').bind(phone).all();
    return json({ phone, orders: r.results.map((x) => { const it = J(x.items) || []; return { id: x.id, created_at: x.created_at, status: x.status, statusText: STATUS[x.status] || x.status, amount_due: x.amount_due, amount_paid: x.amount_paid, count: it.reduce((a, i) => a + (i.qty || 1), 0), title: it[0]?.title || '', store: it[0]?.store || '', image: it[0]?.image || null, more: Math.max(0, it.length - 1) }; }) });
  }

  if ((mm = path.match(/^\/api\/track\/([A-Za-z0-9-]+)$/))) {
    const o = await getOrder(env, mm[1].toUpperCase());
    if (!o || o.phone !== bdPhone(url.searchParams.get('phone'))) return bad('No order found with this number and phone.', 404);
    if (['quote_requested', 'awaiting_payment', 'bank_review', 'paid', 'purchasing', 'purchased', 'at_warehouse', 'problem'].includes(o.status)) o.delivery = refreshPlan(o.delivery, await getPricing(env.DB));
    return json({ order: publicOrder(o, await getEvents(env, o.id)) });
  }

  if ((mm = path.match(/^\/api\/pay\/demo\/([A-Z0-9-]+)$/)) && m === 'POST') {
    if (ssl.paymentsLive(env)) return bad('Demo payments are off', 403);
    const b = await body(req), o = await getOrder(env, mm[1]);
    if (!o || o.phone !== bdPhone(b.phone)) return bad('Order not found', 404);
    await markPaid(env, ctx, o, o.amount_due - o.amount_paid, { method: b.method || o.method, demo: true });
    return json({ ok: true });
  }

  // SSLCommerz: browser returns + server IPN. Always validated with SSLCommerz.
  if (path.startsWith('/pay/') && m === 'POST') {
    const b = await body(req);
    if (path === '/pay/fail' || path === '/pay/cancel') {
      const o = b.value_a && (await getOrder(env, String(b.value_a)));
      if (o) await addEvent(env, o.id, path.endsWith('cancel') ? 'Payment cancelled' : 'Payment failed');
      return redirect(o ? `/order?id=${o.id}&phone=${o.phone}&failed=1` : '/');
    }
    let o = null;
    if (b.val_id && ssl.paymentsLive(env)) {
      const v = await ssl.validatePayment(env, String(b.val_id));
      o = v.orderId && (await getOrder(env, v.orderId));
      if (o && v.ok && !(o.payment?.valIds || []).includes(b.val_id)) {
        await updateOrder(env, o.id, { payment: { ...(o.payment || {}), valIds: [...(o.payment?.valIds || []), b.val_id] } });
        o = await markPaid(env, ctx, await getOrder(env, o.id), v.amount, { method: v.method, tranId: v.tranId });
      } else if (o && !v.ok) await addEvent(env, o.id, 'Payment not valid');
    }
    if (path === '/pay/ipn') return new Response('OK');
    return redirect(o ? `/order?id=${o.id}&phone=${o.phone}&paid=1` : '/order?error=payment');
  }

  // Zinc webhook: we re-check with Zinc instead of trusting the message.
  if (path === '/webhooks/zinc' && m === 'POST') {
    const b = await body(req), zid = b?.id || b?.order_id || b?.data?.id;
    if (zid) {
      const r = await env.DB.prepare('SELECT id FROM orders WHERE zinc LIKE ? LIMIT 1').bind('%' + String(zid).replace(/[%_]/g, '') + '%').first();
      if (r) ctx.waitUntil(getOrder(env, r.id).then((o) => refreshZinc(env, o)));
    }
    return json({ ok: true });
  }

  if (path.startsWith('/api/')) return bad('Not found', 404);
  return env.ASSETS.fetch(req);
}

async function adminApi(req, env, ctx, path, m) {
  if (path === '/api/admin/orders') {
    const r = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 300').all();
    return json({ orders: r.results.map(row2order), statuses: STATUS, demo: { zinc: !env.ZINC_API_KEY, payments: !ssl.paymentsLive(env) } });
  }
  if (path === '/api/admin/dashboard') return json(await dashboard(env, Math.max(1, Math.min(90, parseInt(new URL(req.url).searchParams.get('days'), 10) || 7))));
  if (path === '/api/admin/purchase') {
    const all = new URL(req.url).searchParams.get('all') === '1';
    const r = await env.DB.prepare(`SELECT * FROM orders WHERE status IN (${all ? "'paid','purchasing','purchased','problem','at_warehouse','in_flight','in_dhaka','delivered'" : "'paid','purchasing','problem'"}) ORDER BY created_at LIMIT 300`).all();
    return json({ orders: r.results.map(row2order) });
  }
  if (path === '/api/admin/money') return json(await money(env, Math.max(1, Math.min(366, parseInt(new URL(req.url).searchParams.get('days'), 10) || 30))));
  if (path === '/api/admin/expenses' && m === 'POST') {
    const b = await body(req), amt = Number(b.amount);
    if (!(amt > 0) || amt > 1e8) return bad('Enter an amount.');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(b.day || '') ? b.day : new Date().toISOString().slice(0, 10);
    await env.DB.prepare('INSERT INTO expenses (day,category,amount,currency,note,order_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(day, String(b.category || 'Other').slice(0, 40), amt, b.currency === 'USD' ? 'USD' : 'BDT', String(b.note || '').slice(0, 200), String(b.order || '').toUpperCase().slice(0, 20) || null, nowIso()).run();
    return json({ ok: true });
  }
  let em;
  if ((em = path.match(/^\/api\/admin\/expenses\/(\d+)\/delete$/)) && m === 'POST') { await env.DB.prepare('DELETE FROM expenses WHERE id=?').bind(+em[1]).run(); return json({ ok: true }); }
  if (path === '/api/admin/settings') { const p = m === 'POST' ? await savePricing(env.DB, await body(req)) : await getPricing(env.DB); return json({ pricing: p, upcoming: upcomingFlights(new Date(Date.now() + 6 * 3600e3), p, 10), flightsApi: !!env.FLIGHTS_API_KEY }); }
  const mm = path.match(/^\/api\/admin\/orders\/([A-Z0-9-]+)(?:\/([a-z-]+))?$/);
  if (!mm) return bad('Not found', 404);
  const o = await getOrder(env, mm[1]);
  if (!o) return bad('Not found', 404);
  const action = mm[2];
  if (!action) return json({ order: o, events: await getEvents(env, o.id) });
  if (m !== 'POST') return bad('Use POST', 405);
  const b = await body(req);
  if (action === 'confirm-payment') return json({ order: await markPaid(env, ctx, o, Number(b.amount) || o.amount_due - o.amount_paid, { method: o.method, confirmedBy: 'admin' }) });
  if (action === 'place') {
    if (!['paid', 'purchasing', 'problem'].includes(o.status)) return bad('Order must be paid first.');
    return json({ order: await placeWithZinc(env, o) });
  }
  if (action === 'refresh') return json({ order: await refreshZinc(env, o) });
  // Purchase sheet: agent marks one item bought / can't buy → GENI updates the customer's order page.
  if (action === 'item') {
    const i = parseInt(b.i, 10), it = o.items[i], st = String(b.status || '');
    if (!it || !['bought', 'cant', 'pending'].includes(st)) return bad('Bad item or status');
    const items = o.items.map((x, k) => (k !== i ? x : st === 'pending' ? { ...x, buy: null } : { ...x, buy: { status: st, storeOrder: String(b.storeOrder || '').slice(0, 60), costUsd: Number(b.cost) || null, reason: String(b.reason || '').slice(0, 200), at: nowIso() } }));
    const short = it.title.length > 60 ? it.title.slice(0, 57) + '…' : it.title;
    if (st === 'bought') await addEvent(env, o.id, `GENI bought “${short}” from ${it.store}${b.storeOrder ? ' · store order ' + String(b.storeOrder).slice(0, 60) : ''}`);
    if (st === 'cant') await addEvent(env, o.id, `GENI couldn't buy “${short}” from ${it.store}${b.reason ? ': ' + String(b.reason).slice(0, 200) : ''}. WOOW will contact you for a refund or another option.`);
    const done = items.every((x) => x.buy?.status === 'bought'), anyCant = items.some((x) => x.buy?.status === 'cant'), anyBought = items.some((x) => x.buy?.status === 'bought');
    let status = o.status;
    if (['paid', 'purchasing', 'purchased', 'problem'].includes(o.status)) status = done ? 'purchased' : anyCant ? 'problem' : anyBought ? 'purchasing' : o.status === 'problem' ? 'purchasing' : o.status;
    if (status === 'purchased' && o.status !== 'purchased') await addEvent(env, o.id, 'GENI bought everything — on the way to our US warehouse');
    return json({ order: await updateOrder(env, o.id, { items, status }) });
  }
  if (action === 'set-prices') {
    const pr = await getPricing(env.DB), list = Array.isArray(b.items) ? b.items : [];
    const items = o.items.map((it, i) => ({ ...it, priceCents: Math.round((Number(list[i]?.usd) || it.priceCents / 100) * 100), kg: Number(list[i]?.kg) || it.kg || null, title: String(list[i]?.title || it.title).slice(0, 160) }));
    if (items.some((i) => !i.priceCents)) return bad('Enter a price for every item.');
    const q = quote(items.map(({ lineUsd, lineBdt, ...x }) => x), pr);
    const n = await updateOrder(env, o.id, { items: q.lines, totals: q, amount_due: o.plan === 'split' ? q.payNowSplit : q.total, status: 'awaiting_payment', delivery: deliveryPlan(items.map((i) => i.retailer), pr) });
    await addEvent(env, o.id, `Price quote ready: ৳${q.total.toLocaleString('en-US')}`);
    return json({ order: n });
  }
  if (action === 'status') {
    const s = String(b.status || '');
    if (!STATUS[s]) return bad('Unknown status');
    const n = await updateOrder(env, o.id, { status: s });
    await addEvent(env, o.id, STATUS[s] + (b.note ? ' — ' + String(b.note).slice(0, 200) : ''));
    return json({ order: n });
  }
  return bad('Unknown action', 404);
}

async function feed(env) {
  const DB = env.DB, now = Date.now(), all = (sql, ...a) => DB.prepare(sql).bind(...a).all().then((r) => r.results).catch(() => []);
  const P = (r) => { try { return JSON.parse(r.data); } catch { return null; } };
  const slim = (p) => p && { url: p.url, retailer: p.retailer, store: p.store, title: p.title, image: p.image, priceCents: p.priceCents, listPriceCents: p.listPriceCents || null, kg: p.kg || null, stars: p.stars ?? null, reviews: p.reviews ?? null };
  // 1) just bought: paid orders (city + time only, never names)
  const orders = await all("SELECT items, customer, created_at FROM orders WHERE amount_paid > 0 ORDER BY created_at DESC LIMIT 25");
  const seenB = new Set(), bought = [], count = {};
  for (const o of orders) for (const it of J(o.items) || []) {
    count[it.url] = (count[it.url] || 0) + (it.qty || 1);
    if (seenB.has(it.url) || bought.length >= 16 || it.manual) continue;
    seenB.add(it.url); bought.push({ ...slim(it), city: (J(o.customer) || {}).city || 'Bangladesh', at: Date.parse(o.created_at) });
  }
  // 2) popular: carts ×3 + views + bought ×5 over 30 days
  const pop = await all("SELECT url, SUM(type='cart')*3 + SUM(type='view') score FROM track WHERE ts > ? AND url IS NOT NULL AND type IN ('view','cart') GROUP BY url ORDER BY score DESC LIMIT 40", now - 30 * 864e5);
  const score = {}; pop.forEach((r) => { score[r.url] = r.score; }); Object.entries(count).forEach(([u, n]) => { score[u] = (score[u] || 0) + n * 5; });
  const topUrls = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([u]) => u);
  const rows = topUrls.length ? await all(`SELECT data FROM products WHERE url IN (${topUrls.map(() => '?').join(',')})`, ...topUrls) : [];
  const byUrl = Object.fromEntries(rows.map(P).filter(Boolean).map((p) => [p.url, p]));
  const popular = topUrls.map((u) => byUrl[u]).filter((p) => p && p.priceCents).slice(0, 16).map((p) => ({ ...slim(p), sold: count[p.url] || 0 }));
  // 3) fresh: products other shoppers found in the last 24 h
  const fresh = (await all('SELECT data FROM products WHERE seen > ? ORDER BY seen DESC LIMIT 40', now - 864e5)).map(P).filter((p) => p && p.priceCents && p.image).slice(0, 16).map(slim);
  // 4) trending searches
  const searches = (await all("SELECT lower(q) q, COUNT(*) n FROM track WHERE type='search' AND ts > ? AND q IS NOT NULL AND q != '(popular)' GROUP BY lower(q) ORDER BY n DESC LIMIT 12", now - 7 * 864e5)).map((r) => r.q);
  return { bought, popular, fresh, searches, at: now };
}

// ───────── back office money: received, charged vs actual buying cost, Zinc, expenses, profit ─────────
async function money(env, days) {
  const since = new Date(Date.now() - days * 864e5), sinceIso = since.toISOString(), DB = env.DB;
  const pr = await getPricing(DB), rate = pr.rate;
  const orders = (await DB.prepare("SELECT * FROM orders WHERE created_at >= ? AND status NOT IN ('quote_requested','cancelled') ORDER BY created_at DESC LIMIT 1000").bind(sinceIso).all()).results.map(row2order);
  const zinc = (await DB.prepare('SELECT COALESCE(SUM(cost_cents),0) c FROM zinc_calls WHERE ts >= ?').bind(since.getTime()).first().catch(() => ({ c: 0 }))).c;
  const exp = (await DB.prepare('SELECT * FROM expenses WHERE day >= ? ORDER BY day DESC, id DESC LIMIT 500').bind(sinceIso.slice(0, 10)).all().catch(() => ({ results: [] }))).results;
  const T = { received: 0, charged: 0, goodsCharged: 0, goodsActual: 0, estimated: 0, fee: 0, shipCollected: 0, shipDue: 0, unpaid: 0, overruns: 0 };
  const rows = orders.map((o) => {
    const t = o.totals || {}, r = t.rate || rate, paid = o.amount_paid || 0;
    const goodsCharged = (t.product || 0) + (t.usShip || 0) + (t.usTax || 0);
    let actualUsd = 0, known = 0;
    for (const it of o.items) if (it.buy?.status === 'bought' && Number.isFinite(it.buy.costUsd) && it.buy.costUsd > 0) { actualUsd += it.buy.costUsd; known++; }
    const bought = o.items.filter((i) => i.buy?.status === 'bought').length;
    const allKnown = known === o.items.length;
    const goodsActual = paid > 0 ? (allKnown ? Math.round(actualUsd * r) : goodsCharged) : 0;
    const diff = paid > 0 && allKnown ? goodsCharged - goodsActual : null;
    const shipDue = paid > 0 && o.plan === 'split' && paid < (t.total || 0) ? (t.total || 0) - paid : 0;
    if (paid > 0) {
      T.received += paid; T.charged += t.total || 0; T.goodsCharged += goodsCharged; T.goodsActual += goodsActual; T.fee += t.fee || 0;
      T.shipCollected += o.plan === 'full' ? t.shipping || 0 : Math.max(0, paid - (t.payNowSplit || 0)); T.shipDue += shipDue;
      if (!allKnown) T.estimated++; if (diff !== null && diff < 0) T.overruns++;
    } else T.unpaid += o.amount_due || 0;
    return { id: o.id, at: o.created_at, status: o.status, name: o.customer?.name, city: o.customer?.city, stores: [...new Set(o.items.map((i) => i.store))], items: o.items.length, bought, paid, total: t.total || 0, goodsCharged, goodsActual, diff, fee: t.fee || 0, shipping: t.shipping || 0, shipDue, plan: o.plan, estimated: paid > 0 && !allKnown };
  });
  const expBdt = exp.reduce((a, e) => a + (e.currency === 'USD' ? e.amount * rate : e.amount), 0);
  const byCat = {}; exp.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + (e.currency === 'USD' ? e.amount * rate : e.amount); });
  const zincBdt = Math.round(zinc / 100 * rate);
  const net = Math.round(T.received - T.goodsActual - zincBdt - expBdt);
  return { days, rate, totals: { ...T, zincUsd: zinc / 100, zincBdt, expBdt: Math.round(expBdt), net }, byCat, rows, expenses: exp };
}

// ───────── dashboard: shop activity + Zinc calls & cost ─────────
async function dashboard(env, days) {
  const since = Date.now() - days * 864e5, sinceIso = new Date(since).toISOString(), DB = env.DB;
  const all = (sql, ...a) => DB.prepare(sql).bind(...a).all().then((r) => r.results).catch(() => []);
  const one = (sql, ...a) => DB.prepare(sql).bind(...a).first().catch(() => null);
  const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
  const [types, people, searches, zones, stores, products, recent, ord, zday, zep, ztoday, pr] = await Promise.all([
    all('SELECT type, COUNT(*) n, COUNT(DISTINCT sid) s FROM track WHERE ts>=? GROUP BY type', since),
    one('SELECT COUNT(DISTINCT sid) n FROM track WHERE ts>=?', since),
    all("SELECT lower(q) q, COUNT(*) n, COUNT(DISTINCT sid) people, MAX(store) store FROM track WHERE type='search' AND ts>=? AND q IS NOT NULL GROUP BY lower(q) ORDER BY n DESC LIMIT 15", since),
    all("SELECT country, region, city, COUNT(DISTINCT sid) people, SUM(type='search') searches, SUM(type='view') views, SUM(type='order') orders, SUM(type='paid') paid FROM track WHERE ts>=? GROUP BY country, region, city ORDER BY people DESC LIMIT 15", since),
    all("SELECT store, SUM(type='search') searches, SUM(type='view') views, SUM(type='cart') carts FROM track WHERE ts>=? AND store IS NOT NULL AND store!='all' GROUP BY store ORDER BY views DESC", since),
    all("SELECT url, MAX(q) title, MAX(store) store, MAX(price_cents) price, SUM(type='view') views, SUM(type='cart') carts FROM track WHERE ts>=? AND url IS NOT NULL AND type IN ('view','cart') GROUP BY url ORDER BY views DESC, carts DESC LIMIT 15", since),
    all('SELECT ts, sid, type, country, region, city, store, q, url, price_cents, order_id FROM track ORDER BY id DESC LIMIT 40'),
    one("SELECT COUNT(*) n, SUM(amount_paid>0) paidN, COALESCE(SUM(amount_paid),0) paid FROM orders WHERE created_at>=? AND status!='quote_requested'", sinceIso),
    all("SELECT date(ts/1000,'unixepoch') d, SUM(cost_cents>0) paid, SUM(cost_cents=0) saved, COALESCE(SUM(cost_cents),0) cost FROM zinc_calls WHERE ts>=? GROUP BY d ORDER BY d", since),
    all('SELECT endpoint, COUNT(*) n, COALESCE(SUM(cost_cents),0) cost, SUM(ok=0) fails FROM zinc_calls WHERE ts>=? GROUP BY endpoint ORDER BY n DESC', since),
    one('SELECT COALESCE(SUM(cost_cents),0) cost, SUM(cost_cents>0) paid, SUM(cost_cents=0) saved FROM zinc_calls WHERE ts>=?', day0.getTime()),
    getPricing(DB),
  ]);
  let wallet = null, usage = null;
  try { wallet = await zinc.wallet(env); } catch (e) { wallet = { error: e.message }; }
  try { usage = await zinc.usage(env, days); } catch (e) { usage = { error: e.message }; }
  const T = Object.fromEntries(types.map((x) => [x.type, x]));
  return {
    days, demo: !env.ZINC_API_KEY, people: people?.n || 0, counts: T, orders: ord || {}, searches, zones, stores, products, recent,
    zinc: { byDay: zday, byEndpoint: zep, today: ztoday || {}, budgetCents: pr.zincDailyBudgetCents, wallet, usage },
  };
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) { console.error(e); return bad(e.message || 'Something went wrong', 500); }
  },
  // Every 30 minutes: check Zinc for store order numbers and tracking.
  async scheduled(event, env, ctx) {
    const r = await env.DB.prepare("SELECT * FROM orders WHERE status IN ('purchasing','purchased') ORDER BY updated_at LIMIT 25").all();
    for (const row of r.results) ctx.waitUntil(refreshZinc(env, row2order(row)).catch((e) => console.error(e)));
  },
};
