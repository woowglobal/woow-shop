// WOOW Shop on Cloudflare Workers — API, payments, Zinc purchasing, admin.
// Website files (public/) are served by Cloudflare Static Assets.
import { getPricing, savePricing, quote, deliveryPlan } from './pricing.js';
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
    items: o.items.map((i) => ({ title: i.title, store: i.store, qty: i.qty, image: i.image, lineBdt: i.lineBdt })),
    merchantOrders: (o.zinc?.groups || []).flatMap((g) => g.merchant_order_ids || []), events,
  };
}

// ───────── business logic ─────────
async function markPaid(env, ctx, order, amount, info) {
  if (order.amount_paid >= order.amount_due && !['awaiting_payment', 'bank_review'].includes(order.status)) return order;
  const paid = order.amount_paid + Math.round(amount);
  const o = await updateOrder(env, order.id, { amount_paid: paid, status: paid >= order.amount_due ? 'paid' : order.status, payment: { ...(order.payment || {}), ...info, at: nowIso() } });
  await addEvent(env, order.id, `Payment received: ৳${Math.round(amount).toLocaleString('en-US')} (${info.method || order.method})`);
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
    const r = await zinc.placeOrder(env, { orderId: order.id, retailer, items });
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

async function priceItems(env, raw, { live = false } = {}) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw new Error('Your cart is empty or too big.');
  const items = [];
  for (const r of raw) {
    const qty = Math.max(1, Math.min(9, parseInt(r.qty, 10) || 1));
    const p = await zinc.product(env, String(r.url || ''), { live });
    if (p && p.available === false) throw new Error(`“${p.title.slice(0, 60)}” is out of stock at ${p.store} right now. Please remove it.`);
    if (!p || !p.priceCents) throw new Error('Price not available for one item. Please remove it and try again.');
    items.push({ url: p.url, retailer: p.retailer, store: p.store, title: p.title, image: p.image, priceCents: p.priceCents, kg: p.kg || null, qty, option: String(r.option || '').slice(0, 60) });
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
      defaultKg: p.defaultKg, rateLockMinutes: p.rateLockMinutes, flightDays: p.flightDays, transitDays: p.transitDays, dhakaDaysAfterFlight: p.dhakaDaysAfterFlight,
      stores: zinc.SEARCH_RETAILERS.map((r) => ({ id: r, name: zinc.retailerName(r) })),
      bank: { name: env.BANK_ACCOUNT_NAME || 'WOOW Global (BD)', number: env.BANK_ACCOUNT_NUMBER || '—', branch: env.BANK_NAME_BRANCH || '—' },
    });
  }

  if (path === '/api/search') {
    if (limited(req, 's', 30, 60000)) return bad('Too many searches, please wait a moment.', 429);
    return json({ results: await zinc.search(env, ctx, url.searchParams.get('q') || '', url.searchParams.get('store') || 'all') });
  }

  if (path === '/api/link' && m === 'POST') {
    if (limited(req, 'l', 20, 60000)) return bad('Too many requests, please wait a moment.', 429);
    const u = String((await body(req)).url || '').trim();
    const where = zinc.storeFromUrl(u);
    if (!where) return bad('Please paste a full product link (starting with https://).');
    try {
      const p = await zinc.product(env, u, { fresh: true });
      if (p && p.priceCents) return json({ product: p });
    } catch (e) { if (!e.manual) console.log('link lookup failed', e.message); }
    // Not available automatically (e.g. Costco): offer a price quote from the WOOW team.
    return json({ manual: true, url: u, retailer: where.retailer, store: where.store });
  }

  if (path === '/api/quote' && m === 'POST') {
    const b = await body(req), pr = await getPricing(env.DB), items = await priceItems(env, b.items);
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
    const pr = await getPricing(env.DB), items = await priceItems(env, b.items, { live: true }), q = quote(items, pr), due = plan === 'full' ? q.total : q.payNowSplit;
    const expected = Number(b.expectedTotal);
    if (expected && Math.abs(expected - q.total) >= 1) {
      return json({ error: 'price_changed', message: `The store price changed. New total: ৳${q.total.toLocaleString('en-US')} (was ৳${Math.round(expected).toLocaleString('en-US')}). Please check and press Pay again.`, quote: q, delivery: deliveryPlan(items.map((i) => i.retailer), pr) }, 409);
    }
    const id = await newOrderId(env), t = nowIso();
    const customer = { name: String(c.name).trim().slice(0, 80), phone, email: String(c.email || '').trim().slice(0, 120), address: String(c.address).trim().slice(0, 300), city: String(c.city || 'Dhaka').trim().slice(0, 60) };
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
    return json({ orderId: id, phone });
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

  if ((mm = path.match(/^\/api\/track\/([A-Za-z0-9-]+)$/))) {
    const o = await getOrder(env, mm[1].toUpperCase());
    if (!o || o.phone !== bdPhone(url.searchParams.get('phone'))) return bad('No order found with this number and phone.', 404);
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
  if (path === '/api/admin/settings') return json({ pricing: m === 'POST' ? await savePricing(env.DB, await body(req)) : await getPricing(env.DB) });
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
