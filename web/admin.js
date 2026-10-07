// WOOW Admin — orders, payments, Zinc purchasing, settings
const $ = (id) => document.getElementById(id);
const tk = (n) => '৳' + Math.round(n || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { quote_requested: '#AF52DE', awaiting_payment: '#C7C7CC', bank_review: '#FF9500', paid: '#34C759', purchasing: '#FFD400', purchased: '#007AFF', at_warehouse: '#5856D6', in_flight: '#5AC8FA', in_dhaka: '#AF52DE', delivered: '#1D1D1F', cancelled: '#8E8E93', problem: '#FF3B30' };
let ORDERS = [], STATUS = {};
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(window._t); window._t = setTimeout(() => e.classList.remove('on'), 2000); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
const pill = (s) => `<span class="pill"><i style="background:${COLORS[s] || '#C7C7CC'}"></i>${esc(STATUS[s] || s)}</span>`;

async function load() {
  const d = await api('/api/admin/orders');
  ORDERS = d.orders; STATUS = d.statuses;
  if ($('fSt').options.length === 1) $('fSt').insertAdjacentHTML('beforeend', Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
  if (d.demo.zinc || d.demo.payments) { $('demoBar').hidden = false; $('demoBar').textContent = 'DEMO MODE · ' + [d.demo.zinc && 'Zinc not connected (no real store orders)', d.demo.payments && 'SSLCommerz not connected'].filter(Boolean).join(' · '); }
  draw();
}
function draw() {
  const st = $('fSt').value, q = $('fQ').value.trim().toLowerCase();
  const L = ORDERS.filter((o) => (!st || o.status === st) && (!q || (o.id + ' ' + o.customer.name + ' ' + o.phone).toLowerCase().includes(q)));
  $('rows').innerHTML = L.length ? L.map((o) => `<tr class="r" data-id="${o.id}"><td><b>${o.id}</b><br><small style="color:#86868B">${new Date(o.created_at).toLocaleString()}</small></td>
    <td>${esc(o.customer.name)}<br><small style="color:#86868B">${esc(o.phone)}</small></td>
    <td class="hide-m">${o.items.length} item${o.items.length > 1 ? 's' : ''} · ${[...new Set(o.items.map((i) => i.store))].map(esc).join(', ')}</td>
    <td>${tk(o.amount_due)}<br><small style="color:${o.amount_paid >= o.amount_due ? '#248A3D' : '#86868B'}">${tk(o.amount_paid)} paid · ${esc(o.method)}</small></td>
    <td>${pill(o.status)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#86868B;padding:30px">No orders yet</td></tr>';
}
$('rows').addEventListener('click', (e) => { const r = e.target.closest('tr.r'); if (r) openO(r.dataset.id); });
$('fSt').onchange = draw; $('fQ').oninput = draw;

async function openO(id) {
  const { order: o, events } = await api('/api/admin/orders/' + id);
  const z = o.zinc?.groups || [];
  $('dr').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><h1 style="font-size:22px">${o.id}</h1><button class="hb" onclick="$('dr').classList.remove('on')">✕</button></div>
  <div style="margin-top:6px">${pill(o.status)}</div>
  <div class="kv"><span>Customer</span><b>${esc(o.customer.name)}</b><span>Mobile</span><b>${esc(o.phone)}</b><span>Email</span><b>${esc(o.customer.email || '—')}</b><span>Delivery</span><b>${o.customer.deliveryType === 'pickup' ? '🏢 Pick up at WOOW Baridhara DOHS (free)' : '🏠 Home delivery'}</b>
  <span>Address</span><b>${esc(o.customer.address)}, ${esc(o.customer.city)}${o.customer.addr?.lat ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${o.customer.addr.lat},${o.customer.addr.lng}" target="_blank" rel="noopener" style="color:#0066CC">map ↗</a>${o.customer.addr.verified ? ' ✓' : ''}` : ''}</b>
  <span>Plan</span><b>${o.plan === 'full' ? 'Pay all now' : 'Product now, shipping on arrival'}</b><span>Method</span><b>${esc(o.method)}${o.payment?.reference ? ' · ref ' + esc(o.payment.reference) : ''}</b>
  <span>Due / paid</span><b>${tk(o.amount_due)} / ${tk(o.amount_paid)}</b><span>Total</span><b>${tk(o.totals.total)} (rate ৳${o.totals.rate})</b>
  <span>Flight</span><b>${o.delivery ? o.delivery.flight + ' · ' + o.delivery.flightNo : '—'}</b></div>
  <h3 style="font-size:14px;margin:16px 0 6px">Items</h3>
  ${o.items.map((i) => `<div class="ci"><img src="${esc(i.image || '')}" alt=""><div><b>${esc(i.title)}</b><small>${esc(i.store)} · Qty ${i.qty} · $${i.lineUsd.toFixed(2)}${i.option ? ' · ' + esc(i.option) : ''}</small><br><a href="${esc(i.url)}" target="_blank" rel="noopener" style="font-size:12px;color:#0066CC">Open in store ↗</a></div><b>${tk(i.lineBdt)}</b></div>`).join('')}
  <h3 style="font-size:14px;margin:16px 0 6px">Store purchases (Zinc)</h3>
  ${z.length ? z.map((g) => `<div class="kv"><span>${esc(g.retailer)}</span><b>${esc(g.status)}${g.error ? ' · ⚠ ' + esc(g.error) : ''}</b><span>Zinc id</span><b style="font-size:11px">${esc(g.id)}</b><span>Store order</span><b>${esc((g.merchant_order_ids || []).join(', ') || '—')}</b><span>Tracking</span><b>${esc((g.tracking || []).map((t) => t.carrier + ' ' + t.number).join(', ') || '—')}</b></div>`).join('') : '<p style="color:#86868B;font-size:13px;margin:0">Not placed yet.</p>'}
  ${o.status === 'quote_requested' ? `<h3 style="font-size:14px;margin:16px 0 6px">💬 Send price quote</h3>
   ${o.items.map((i, k) => `<div class="kv" style="grid-template-columns:1fr 110px 90px;align-items:end"><label style="font-size:11px;color:#86868B">Product name<input class="inp" id="qt${k}" value="${esc(i.title)}"></label><label style="font-size:11px;color:#86868B">Price each, USD<input class="inp" id="qu${k}" inputmode="decimal" value="${i.priceCents ? (i.priceCents / 100).toFixed(2) : ''}"></label><label style="font-size:11px;color:#86868B">Weight kg<input class="inp" id="qk${k}" inputmode="decimal" value="${i.kg || ''}"></label></div>${i.customerNote ? `<small style="color:#86868B">Customer note: ${esc(i.customerNote)}</small>` : ''}`).join('')}
   <button class="btn" style="margin-top:6px" onclick="sendQuote('${o.id}',${o.items.length})">Send quote to customer →</button>` : ''}
  <div class="act">
    <button class="btn" onclick="act('${o.id}','confirm-payment')">✓ Confirm payment</button>
    <button class="btn dk" onclick="if(confirm('Place real store orders with Zinc now?'))act('${o.id}','place')">🛒 Buy with Zinc</button>
    <button class="btn ln" onclick="act('${o.id}','refresh')">↻ Refresh Zinc status</button>
    <select class="inp" id="ns" style="height:44px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
  </div>
  <input class="inp" id="nn" placeholder="Note for this update (optional)" style="margin-top:8px">
  <button class="btn ln" style="margin-top:8px" onclick="setSt('${o.id}')">Update status</button>
  <h3 style="font-size:14px;margin:18px 0 8px">History</h3>
  ${events.map((e) => `<div class="ev">${esc(e.text)}<small>${new Date(e.at).toLocaleString()}</small></div>`).join('')}`;
  $('dr').classList.add('on');
}
async function sendQuote(id, n) {
  const items = [...Array(n)].map((_, k) => ({ title: $('qt' + k).value, usd: $('qu' + k).value, kg: $('qk' + k).value }));
  try { await api(`/api/admin/orders/${id}/set-prices`, { items }); toast('Quote sent — customer can pay now'); await load(); openO(id); } catch (e) { toast(e.message); }
}
async function act(id, a) {
  try { await api(`/api/admin/orders/${id}/${a}`, {}); toast('Done'); await load(); openO(id); } catch (e) { toast(e.message); }
}
async function setSt(id) {
  try { await api(`/api/admin/orders/${id}/status`, { status: $('ns').value, note: $('nn').value }); toast('Status updated'); await load(); openO(id); } catch (e) { toast(e.message); }
}

// settings
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function loadSet() {
  const S = await api('/api/admin/settings'), p = S.pricing;
  $('sRate').value = p.rate; $('sFee').value = p.feePercent; $('sMin').value = p.minFee; $('sKg').value = p.kgRate; $('sDef').value = p.defaultKg; $('sLand').value = p.dhakaDaysAfterFlight; $('sPack').value = p.packagingPercent ?? 10; $('sBrk').value = (p.brokerageList || []).join('\n');
  $('sWh').value = p.warehouseState || 'DE'; $('sNy').value = p.taxRates?.NY ?? 8.875; $('sDe').value = p.taxRates?.DE ?? 0;
  $('sBud').value = ((p.zincDailyBudgetCents ?? 300) / 100).toFixed(2); $('sFresh').value = p.liveFreshMinutes ?? 15;
  const G = p.guard || {}; $('gBrowse').value = G.browsePer30 ?? 50; $('gPaid').value = G.paidPer30 ?? 50; $('gGuest').value = G.guestPaidPer30 ?? 15; $('gIp').value = G.ipPaidPer30 ?? 100; $('gHours').value = G.blockHours ?? 6; $('sHome').value = p.homeDeliveryFee ?? 0;
  const SH = p.usShipping || {};
  $('sShip').innerHTML = [...new Set(['amazon', 'walmart', 'target', 'bestbuy', 'macys', 'costco', ...Object.keys(SH).filter((k) => k !== 'default'), 'default'])].map((k) => `<div data-k="${k}">${k === 'default' ? 'Other stores' : esc(k)}<span><label style="flex:1;font-size:10.5px;color:#86868B">Free over $<input class="inp" data-f="freeOver" value="${SH[k]?.freeOver ?? 35}"></label><label style="flex:1;font-size:10.5px;color:#86868B">Else fee $<input class="inp" data-f="fee" value="${SH[k]?.fee ?? 7.99}"></label></span></div>`).join('');
  $('sMD').value = (p.flightMonthDays || [10, 20, 30]).join(', ');
  FL = p.flights || []; drawFlights(S.upcoming); $('sFlApi').innerHTML = S.flightsApi ? '🔗 WOOW main admin can update flights automatically (API on).' : 'Auto update from WOOW main admin: add secret <b>FLIGHTS_API_KEY</b> in Cloudflare, then send flights to <code>/api/flights</code>.';
}
async function saveSet() {
  try { await api('/api/admin/settings', { rate: $('sRate').value, feePercent: $('sFee').value, minFee: $('sMin').value, kgRate: $('sKg').value, defaultKg: $('sDef').value, dhakaDaysAfterFlight: $('sLand').value, packagingPercent: $('sPack').value, brokerageList: $('sBrk').value.split('\n'), flightMonthDays: $('sMD').value.split(/[^0-9]+/).filter(Boolean).map(Number),
    warehouseState: $('sWh').value, taxRates: { DE: $('sDe').value, NY: $('sNy').value }, zincDailyBudgetCents: Math.round(Number($('sBud').value) * 100), liveFreshMinutes: $('sFresh').value, homeDeliveryFee: $('sHome').value,
    guard: { browsePer30: $('gBrowse').value, paidPer30: $('gPaid').value, guestPaidPer30: $('gGuest').value, ipPaidPer30: $('gIp').value, blockHours: $('gHours').value },
    usShipping: Object.fromEntries([...$('sShip').children].map((d) => [d.dataset.k, { freeOver: d.querySelector('[data-f=freeOver]').value, fee: d.querySelector('[data-f=fee]').value }])) }); toast('Settings saved'); } catch (e) { toast(e.message); }
}
document.querySelector('.tabs2').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.tabs2 button').forEach((x) => x.classList.toggle('on', x === b));
  ['dash', 'buy', 'money', 'cust', 'orders', 'settings'].forEach((t) => { $('t-' + t).hidden = b.dataset.t !== t; });
  if (b.dataset.t === 'cust') loadCust();
  if (b.dataset.t === 'money') loadMoney(); if (b.dataset.t === 'settings') loadSet(); if (b.dataset.t === 'dash') loadDash(); if (b.dataset.t === 'buy') loadBuy();
});

// ───────── WOOW flights: monthly days + moved / cancelled / extra flights ─────────
let FL = [];
const fdate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function drawFlights(up) {
  const cx = FL.filter((f) => f.cancelled && f.date >= new Date().toISOString().slice(0, 10));
  $('sFl').innerHTML = (up || []).map((f) => `<div class="flr"><b>${fdate(f.date)}</b><span>${esc(f.no)}</span><span style="color:#86868B">${esc(f.note || '')}</span><span class="src ${f.source}">${f.source === 'set' ? 'Updated' : 'Monthly'}</span>
    <div><button onclick="moveFlight('${f.date}')">Move</button><button class="x" onclick="cancelFlight('${f.date}')">Cancel</button></div></div>`).join('') +
    cx.map((f) => `<div class="flr" style="opacity:.55"><s>${fdate(f.date)}</s><span>Cancelled</span><span></span><span></span><div><button onclick="restoreFlight('${f.date}')">Restore</button></div></div>`).join('');
}
async function saveFlights(msg) {
  try { const S = await api('/api/admin/settings', { flights: FL }); FL = S.pricing.flights; drawFlights(S.upcoming); toast(msg); } catch (e) { toast(e.message); }
}
const askDate = (t, d) => { const v = prompt(t + ' (YYYY-MM-DD)', d || ''); return v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null; };
function moveFlight(d) {
  const n = askDate('Move the ' + fdate(d) + ' flight to', d); if (!n || n === d) return;
  const note = prompt('Reason (customers may see it)', 'Schedule changed by airline') || '';
  FL = FL.filter((f) => f.date !== d && f.date !== n); FL.push({ date: d, cancelled: true }, { date: n, note }); saveFlights('Flight moved — delivery dates updated');
}
function cancelFlight(d) { if (!confirm('Cancel the ' + fdate(d) + ' flight?')) return; FL = FL.filter((f) => f.date !== d); FL.push({ date: d, cancelled: true }); saveFlights('Flight cancelled'); }
function restoreFlight(d) { FL = FL.filter((f) => f.date !== d); saveFlights('Flight restored'); }
function addFlight() { const d = askDate('New flight date'); if (!d) return; const no = prompt('Flight number (optional)', '') || ''; FL = FL.filter((f) => f.date !== d); FL.push({ date: d, no }); saveFlights('Flight added'); }

// ───────── Dashboard: shop activity + Zinc calls & cost ─────────
let DAYS_N = 7;
const n0 = (x) => Number(x || 0).toLocaleString('en-US');
const money = (x) => x == null ? '—' : '$' + (Number.isInteger(x) ? x / 100 : x).toFixed(2); // Zinc amounts in cents
const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
const zoneTxt = (r) => [r.city, r.region, r.country].filter(Boolean).join(', ') || 'Unknown';
const TYPE = { visit: '👋 Visit', search: '🔍 Search', view: '👀 Viewed', compare: '⚖️ Compared', cart: '🛒 Add to cart', checkout: '💳 Checkout', link: '🔗 Pasted link', quote: '💬 Quote request', order: '📦 Order placed', paid: '✅ Paid', recent: '↩ Recently viewed' };
$('dDays').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; DAYS_N = +b.dataset.d; $('dDays').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadDash(); });
async function unblock(who) { await api('/api/admin/security', { who }); toast('Unblocked'); loadDash(); }
async function loadDash() {
  let d; try { d = await api('/api/admin/dashboard?days=' + DAYS_N); } catch (e) { $('dash').innerHTML = `<div class="card sec">${esc(e.message)}</div>`; return; }
  const C = d.counts, c = (k) => C[k]?.n || 0, ps = (k) => C[k]?.s || 0, z = d.zinc, t = z.today || {};
  const kp = (l, v, sub) => `<div><small>${l}</small><b>${v}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const fun = [['Visitors', d.people], ['Searched', ps('search')], ['Viewed product', ps('view')], ['Added to cart', ps('cart')], ['Checkout', ps('checkout')], ['Ordered', ps('order')], ['Paid', ps('paid')]];
  const top = Math.max(1, d.people);
  const paidCalls = z.byEndpoint.filter((x) => x.cost > 0).reduce((a, x) => a + x.n, 0), savedCalls = z.byEndpoint.filter((x) => /saved/.test(x.endpoint)).reduce((a, x) => a + x.n, 0);
  const cost = z.byEndpoint.reduce((a, x) => a + x.cost, 0), budget = z.budgetCents || 0, bp = budget ? Math.min(100, Math.round((t.cost || 0) / budget * 100)) : 0;
  const mx = Math.max(1, ...z.byDay.map((x) => x.paid + x.saved));
  const w = z.wallet && !z.wallet.error ? z.wallet : null;
  const usageRows = z.usage && z.usage.metrics ? Object.entries(z.usage.metrics).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${n0(v.total)}</td><td><small>${n0(v.prev_total)} before</small></td></tr>`).join('') : '';
  const tbl = (head, rows) => `<table class="mt"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" style="color:#86868B">No data yet</td></tr>`}</tbody></table>`;
  const late = BUY.filter((r) => !r.it.buy && Date.now() - r.paidAt > 3600e3).length, toBuy = BUY.filter((r) => !r.it.buy).length;
  let M = null; try { M = await api('/api/admin/money?days=30'); } catch {}
  let SEC = null; try { SEC = await api('/api/admin/security'); } catch {}
  const al = [];
  if (late) al.push(['r', `⏱️ ${late} paid item${late > 1 ? 's' : ''} waiting more than 1 hour to be bought`, 'buy']);
  else if (toBuy) al.push(['y', `🛒 ${toBuy} paid item${toBuy > 1 ? 's' : ''} to buy`, 'buy']);
  if (M?.totals.overruns) al.push(['r', `💸 ${M.totals.overruns} order${M.totals.overruns > 1 ? 's' : ''} cost more to buy than the customer paid`, 'money']);
  if (M?.totals.shipDue) al.push(['y', `📦 ${tk(M.totals.shipDue)} shipping still to collect (second invoices)`, 'money']);
  if (budget && (t.cost || 0) >= budget * 0.85) al.push(['r', `⚠️ Zinc daily budget almost used (${money(t.cost || 0)} of ${money(budget)}) — searches now use saved products`, 'settings']);
  if (w && Number(w.balance ?? w.spendable_balance) < 500) al.push(['r', `💳 Zinc balance low: ${money(w.balance ?? w.spendable_balance)} — top up at zinc.com`, null]);
  const act = (SEC?.blocked || []).filter((b) => b.active).length;
  if (act) al.push(['r', `🛡️ ${act} suspicious visitor${act > 1 ? 's' : ''} blocked from paid store lookups`, null]);
  if (!al.length) al.push(['g', '✅ All good — nothing waiting', null]);
  const secCard = SEC ? `<div class="card sec"><h3>🛡️ Security &amp; customers <small>${SEC.users} customer account${SEC.users === 1 ? '' : 's'}</small></h3>
    <p class="lead2">Bots and very fast browsing (more than the limits in Settings) can't spend Zinc money — they only see saved products.</p>
    ${tbl(['Visitor', 'Why', 'Until', ''], SEC.blocked.map((b) => `<tr><td><small>${esc(b.who)}</small></td><td>${esc(b.reason || '')}${b.hits > 1 ? ` <small>×${b.hits}</small>` : ''}</td><td>${b.active ? new Date(b.until).toLocaleString() : '<small>ended</small>'}</td><td>${b.active ? `<button class="hb" style="height:28px;background:#F2F2F7;color:#1D1D1F" onclick="unblock('${esc(b.who)}')">Unblock</button>` : ''}</td></tr>`).join(''))}
    <h3 style="font-size:13px;margin:14px 0 4px">Wrong sign-in attempts (24 h)</h3>${tbl(['Who', 'Tries'], SEC.fails.map((f) => `<tr><td><small>${esc(f.k.replace(/^adm:/, 'ADMIN login · IP ').replace(/^ph:/, 'Mobile ').replace(/^ip:/, 'IP ').replace(/^su:/, 'Sign-up · IP '))}</small></td><td>${f.n}</td></tr>`).join(''))}
    <h3 style="font-size:13px;margin:14px 0 4px">New customers</h3>${tbl(['Name', 'Mobile', 'Joined'], SEC.newUsers.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.phone)}</td><td><small>${new Date(u.created_at).toLocaleDateString()}</small></td></tr>`).join(''))}</div>` : '';
  $('dash').innerHTML = `<div class="al">${al.map(([c, x, tab]) => `<a class="${c}" ${tab ? `onclick="document.querySelector('[data-t=${tab}]').click()"` : ''}>${x}${tab ? '<b>Open →</b>' : ''}</a>`).join('')}</div>
  <div class="kp">${kp('Visitors', n0(d.people))}${kp('Searches', n0(c('search')), n0(ps('search')) + ' people')}${kp('Product views', n0(c('view')))}${kp('Add to cart', n0(c('cart')))}
  ${kp('Orders placed', n0(d.orders.n))}${kp('Paid orders', n0(d.orders.paidN))}${kp('Money received', tk(d.orders.paid))}${kp('Zinc cost', money(cost), n0(paidCalls) + ' paid calls')}</div>
  <div class="g2">
    <div class="card sec"><h3>Customer journey <small>people</small></h3><div class="fn">${fun.map(([l, v]) => `<div><span>${l}</span><i style="width:${Math.max(2, Math.round(v / top * 100))}%"></i><b>${n0(v)}</b></div>`).join('')}</div></div>
    <div class="card sec"><h3>Zinc.com <small>${d.demo ? 'demo — no key' : 'live'}</small></h3>
      <div class="zb"><div><small>Balance</small><b>${w ? money(w.balance ?? w.spendable_balance) : '—'}</b></div><div><small>Paid calls · ${DAYS_N}d</small><b>${n0(paidCalls)}</b></div><div><small>Saved calls (free)</small><b style="color:#248A3D">${n0(savedCalls)}</b></div></div>
      <div style="font-size:12px;display:flex;justify-content:space-between"><span>Today ${money(t.cost || 0)} of ${money(budget)} daily budget</span><b>${n0(t.paid)} paid · ${n0(t.saved)} saved</b></div>
      <div class="bar"><u class="${bp > 85 ? 'hi' : ''}" style="width:${bp}%"></u></div>
      ${z.byDay.length ? '' : '<p class="lead2" style="margin:14px 0">No Zinc calls yet.</p>'}<div class="ch" ${z.byDay.length ? '' : 'hidden'}>${z.byDay.map((x) => `<div title="${x.d}: ${x.paid} paid ($${(x.cost / 100).toFixed(2)}), ${x.saved} saved"><s style="height:${Math.round(x.saved / mx * 100)}%"></s><u style="height:${Math.round(x.paid / mx * 100)}%"></u><small>${x.d.slice(8)}</small></div>`).join('')}</div>
      <p class="lead2" style="margin-top:22px" ${z.byDay.length ? '' : 'hidden'}>■ dark = paid call (≈ $0.01) · ■ green = answered free from WOOW's saved data</p>
      ${tbl(['Call', 'Count', 'Cost', 'Failed'], z.byEndpoint.map((x) => `<tr><td>${esc(x.endpoint.replace('_', ' '))}</td><td>${n0(x.n)}</td><td>${money(x.cost)}</td><td>${x.fails || ''}</td></tr>`).join(''))}
      ${usageRows ? '<h3 style="font-size:13px;margin:12px 0 4px">Zinc\'s own count</h3>' + tbl(['Endpoint', 'Calls', ''], usageRows) : ''}</div>
  </div>
  <div class="g2">
    <div class="card sec"><h3>Top searches</h3>${tbl(['Search', 'Times', 'People'], d.searches.map((x) => `<tr><td>${esc(x.q)}${x.store && x.store !== 'all' ? ` <small>${esc(x.store)}</small>` : ''}</td><td>${n0(x.n)}</td><td>${n0(x.people)}</td></tr>`).join(''))}</div>
    <div class="card sec"><h3>Customers by zone</h3>${tbl(['Zone', 'People', 'Searches', 'Orders', 'Paid'], d.zones.map((x) => `<tr><td>${esc(zoneTxt(x))}</td><td>${n0(x.people)}</td><td>${n0(x.searches)}</td><td>${n0(x.orders)}</td><td>${n0(x.paid)}</td></tr>`).join(''))}</div>
  </div>
  <div class="g2">
    <div class="card sec"><h3>Most viewed products</h3>${tbl(['Product', 'Price', 'Views', 'Cart'], d.products.map((x) => `<tr><td><a href="${esc(x.url)}" target="_blank" rel="noopener" style="color:#0066CC;text-decoration:none">${esc((x.title || x.url).slice(0, 70))} ↗</a> <small>${esc(x.store || '')}</small></td><td>${x.price ? '$' + (x.price / 100).toFixed(2) : ''}</td><td>${n0(x.views)}</td><td>${n0(x.carts)}</td></tr>`).join(''))}</div>
    <div class="card sec"><h3>By store</h3>${tbl(['Store', 'Searches', 'Views', 'Cart'], d.stores.map((x) => `<tr><td>${esc(x.store)}</td><td>${n0(x.searches)}</td><td>${n0(x.views)}</td><td>${n0(x.carts)}</td></tr>`).join(''))}
      <h3 style="margin-top:16px">Live activity</h3><div style="max-height:420px;overflow:auto">${d.recent.map((r) => `<div class="act2">${TYPE[r.type] || esc(r.type)} ${r.q ? '· ' + esc(r.q.slice(0, 60)) : ''}${r.order_id ? ' · ' + esc(r.order_id) : ''}${r.price_cents && r.type !== 'order' && r.type !== 'paid' ? ' · $' + (r.price_cents / 100).toFixed(2) : r.price_cents ? ' · ' + tk(r.price_cents) : ''}<br><small>${esc(zoneTxt(r))} · ${ago(r.ts)} ago · visitor ${esc((r.sid || '').slice(0, 6))}</small></div>`).join('') || '<p class="lead2">No activity yet</p>'}</div></div>
  </div>${secCard}`;
}

// ───────── Purchase sheet: paid items to buy now ─────────
let BUY = [], BUY_ALL = 0;
$('bAll').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; BUY_ALL = +b.dataset.a; $('bAll').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadBuy(); });
$('bQ').oninput = () => drawBuy();
async function loadBuy() {
  const d = await api('/api/admin/purchase' + (BUY_ALL ? '?all=1' : ''));
  BUY = d.orders.flatMap((o) => o.items.map((it, i) => ({ o, it, i, paidAt: Date.parse(o.payment?.at || o.updated_at) })));
  const open = BUY.filter((r) => !r.it.buy).length; $('buyN').textContent = BUY_ALL ? '' : (open || '');
  drawBuy();
}
function waText(r, kind) {
  const n = r.o.customer.name.split(' ')[0], t = r.it.title.slice(0, 70);
  return kind === 'cant' ? `Hi ${n}, GENI from WOOW here. Sorry — we couldn't buy "${t}" from ${r.it.store} for your order ${r.o.id}${r.it.buy?.reason ? ' (' + r.it.buy.reason + ')' : ''}. We can refund it or find another option for you. Reply here.`
    : kind === 'bought' ? `Hi ${n}, GENI from WOOW here. Good news — we bought "${t}" from ${r.it.store} for your order ${r.o.id}. It's on the way to our US warehouse. Track: ${location.origin}/order?id=${r.o.id}&phone=${r.o.phone}`
    : `Hi ${n}, GENI from WOOW here about your order ${r.o.id}.`;
}
const wa = (r, k) => `https://wa.me/88${r.o.phone}?text=${encodeURIComponent(waText(r, k))}`;
// Quick buy: put every open item into WOOW's own Amazon / Walmart cart in one click (purchaser is logged in there),
// then pay with WOOW's card and ship to the WOOW warehouse address saved in that account.
const asin = (u) => (String(u).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1];
const wmId = (u) => (String(u).match(/walmart\.com\/ip\/(?:[^/]+\/)?(\d+)/) || [])[1];
const ZINC_OK = ['amazon', 'walmart'];
function quickBuy(L) {
  const open = L.filter((r) => !r.it.buy && !(r.o.zinc?.groups || []).some((g) => g.retailer === r.it.retailer && g.id));
  const by = {}; open.forEach((r) => (by[r.it.retailer] ||= []).push(r));
  const out = [];
  const qty = (rs, idf) => { const m = new Map(); rs.forEach((r) => { const id = idf(r.it.url); if (id) m.set(id, (m.get(id) || 0) + r.it.qty); }); return [...m]; };
  if (by.amazon) { const q = qty(by.amazon, asin); if (q.length) out.push(`<a class="am" target="_blank" rel="noopener" href="https://www.amazon.com/gp/aws/cart/add.html?${q.map(([id, n], i) => `ASIN.${i + 1}=${id}&Quantity.${i + 1}=${n}`).join('&')}">🛒 Add all to <i>Amazon</i> cart <small>${q.length} product${q.length > 1 ? 's' : ''}</small></a>`); }
  if (by.walmart) { const q = qty(by.walmart, wmId); if (q.length) out.push(`<a class="wm" target="_blank" rel="noopener" href="https://affil.walmart.com/cart/addToCart?items=${q.map(([id, n]) => id + '|' + n).join(',')}">🛒 Add all to <i>Walmart</i> cart <small>${q.length} product${q.length > 1 ? 's' : ''}</small></a>`); }
  Object.entries(by).filter(([k]) => !['amazon', 'walmart'].includes(k)).forEach(([k, rs]) => out.push(`<button class="ot" onclick='openAll(${JSON.stringify(rs.map((r) => r.it.url))})'>↗ Open ${esc(rs[0].it.store)} items <small>${rs.length}</small></button>`));
  $('qBuy').innerHTML = out.join('');
}
function openAll(urls) { urls.forEach((u) => window.open(u, '_blank', 'noopener')); }
async function zincBuy(id) {
  if (!confirm('Place this order automatically with Zinc now? (Zinc buys and ships to the WOOW warehouse)')) return;
  try { await api(`/api/admin/orders/${id}/place`, {}); toast('Sent to Zinc — status updates every 30 min'); loadBuy(); } catch (e) { toast(e.message); }
}
function drawBuy() {
  const q = $('bQ').value.trim().toLowerCase();
  const L = BUY.filter((r) => !q || (r.o.id + ' ' + r.o.customer.name + ' ' + r.o.phone + ' ' + r.it.title + ' ' + r.it.store).toLowerCase().includes(q));
  $('bRows').innerHTML = L.length ? L.map((r, k) => {
    const b = r.it.buy, mins = (Date.now() - r.paidAt) / 60000, z = r.o.customer.zone || {};
    const st = b?.status === 'bought' ? `<span class="tagb ok">✓ Bought</span><br><small>${esc(b.storeOrder || '')}${b.costUsd ? ' · $' + b.costUsd.toFixed(2) : ''}</small>` : b?.status === 'cant' ? `<span class="tagb no">Can't buy</span><br><small>${esc(b.reason || '')}</small>` : (() => { const g = (r.o.zinc?.groups || []).find((x) => x.retailer === r.it.retailer && x.id); return g ? `<span class="tagb">Zinc: ${esc(g.status)}</span>` : '<span class="tagb">To buy</span>'; })();
    return `<tr><td class="w ${!b && mins > 60 ? 'late' : ''}">${b ? '—' : ago(r.paidAt)}</td>
    <td><b>${r.o.id}</b><br>${esc(r.o.customer.name)} · ${esc(r.o.phone)}<br><small style="color:#86868B">${esc(r.o.customer.city)}${z.city ? ' · seen in ' + esc(z.city) : ''}</small></td>
    <td style="min-width:260px"><img src="${esc(r.it.image || '')}" alt=""><a href="${esc(r.it.url)}" target="_blank" rel="noopener">${esc(r.it.title.slice(0, 80))} ↗</a><br><small style="color:#86868B">${esc(r.it.store)}${r.it.option ? ' · ' + esc(r.it.option) : ''}</small></td>
    <td><b>${r.it.qty}</b></td><td>$${(r.it.priceCents / 100).toFixed(2)}<br><small style="color:#86868B">line $${(r.it.priceCents * r.it.qty / 100).toFixed(2)}</small>${(() => { const st = (r.o.totals?.stores || []).find((x) => x.retailer === r.it.retailer); const first = r.o.items.findIndex((x) => x.retailer === r.it.retailer) === r.i; return st && first ? `<br><small style="color:${st.shipUsd ? '#B25E00' : '#248A3D'}">${st.shipUsd ? 'US ship paid $' + st.shipUsd.toFixed(2) : 'Free US ship'}${st.sellerShipUsd ? ' (seller)' : ''}</small>` : ''; })()}</td><td>${st}</td>
    <td><div class="acts">${b ? `<button class="un" onclick="mark(${k},'pending')">Undo</button>` : `<button class="ok" onclick="mark(${k},'bought')">✓ Bought</button><button class="no" onclick="mark(${k},'cant')">✕ Can't</button>${ZINC_OK.includes(r.it.retailer) && r.o.status === 'paid' && !(r.o.zinc?.groups || []).length ? `<button class="zn" onclick="zincBuy('${r.o.id}')">⚡ Zinc</button>` : ''}`}<a class="wa" target="_blank" rel="noopener" href="${wa(r, b?.status)}">WhatsApp</a></div></td></tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;color:#86868B;padding:30px">Nothing to buy right now 🎉</td></tr>';
  window._L = L; quickBuy(L);
}
async function mark(k, status) {
  const r = window._L[k]; const b = { i: r.i, status };
  if (status === 'bought') { const so = prompt('Store order number (from ' + r.it.store + ')', ''); if (so === null) return; b.storeOrder = so; const c = prompt('What did it actually cost? (USD, optional)', (r.it.priceCents * r.it.qty / 100).toFixed(2)); if (c === null) return; b.cost = c; }
  if (status === 'cant') { const re = prompt('Why can\'t we buy it? (customer will see this)', 'Out of stock at the store'); if (re === null) return; b.reason = re; }
  try { await api(`/api/admin/orders/${r.o.id}/item`, b); toast(status === 'pending' ? 'Reset' : 'Saved — customer updated by GENI'); await loadBuy(); load(); } catch (e) { toast(e.message); }
}
function csv() {
  const rows = [['Paid at', 'Order', 'Customer', 'Phone', 'City', 'Zone', 'Store', 'Product', 'Link', 'Option', 'Qty', 'Price USD', 'Line USD', 'Status', 'Store order', 'Actual cost USD', 'Reason']];
  BUY.forEach((r) => { const z = r.o.customer.zone || {}; rows.push([new Date(r.paidAt).toISOString(), r.o.id, r.o.customer.name, r.o.phone, r.o.customer.city, [z.city, z.region, z.country].filter(Boolean).join(' / '), r.it.store, r.it.title, r.it.url, r.it.option || '', r.it.qty, (r.it.priceCents / 100).toFixed(2), (r.it.priceCents * r.it.qty / 100).toFixed(2), r.it.buy?.status || 'to buy', r.it.buy?.storeOrder || '', r.it.buy?.costUsd || '', r.it.buy?.reason || '']); });
  const text = rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' })); a.download = 'woow-purchase-sheet-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
}

// ───────── Money: received, buying cost, Zinc, expenses, profit ─────────
let M_DAYS = 30, MONEY = null;
const EXP_CATS = ['Air freight', 'Customs & clearing', 'US warehouse', 'Dhaka courier', 'Staff', 'Marketing', 'Zinc order fees', 'Packaging', 'Bank & gateway fees', 'Refund', 'Other'];
$('mDays').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; M_DAYS = +b.dataset.d; $('mDays').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadMoney(); });
async function loadMoney() {
  let d; try { d = MONEY = await api('/api/admin/money?days=' + M_DAYS); } catch (e) { $('money').innerHTML = `<div class="card sec">${esc(e.message)}</div>`; return; }
  const T = d.totals, sg = (x) => `<span class="${x < 0 ? 'neg' : 'pos'}">${x < 0 ? '−' : '+'}${tk(Math.abs(x))}</span>`;
  const kp = (l, v, sub) => `<div><small>${l}</small><b>${v}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const tbl = (head, rows) => `<table class="mt"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length}" style="color:#86868B">Nothing yet</td></tr>`}</tbody></table>`;
  $('money').innerHTML = `
  <div class="kp">${kp('Money received', tk(T.received))}${kp('Bought from stores', tk(T.goodsActual), T.estimated ? T.estimated + ' estimated' : '')}${kp('Expenses + Zinc', tk(T.expBdt + T.zincBdt))}${kp('Net profit', sg(T.net))}</div>
  <div class="g2">
    <div class="card sec"><h3>Profit &amp; loss <small>last ${d.days} day${d.days > 1 ? 's' : ''} · $1 = ৳${d.rate}</small></h3><div class="pl">
      <div><span>Money received from customers</span><b>${tk(T.received)}</b></div>
      <div><span>Products bought from stores <small>(actual cost${T.estimated ? '; ' + T.estimated + ' order' + (T.estimated > 1 ? 's' : '') + ' still estimated' : ''})</small></span><b>−${tk(T.goodsActual)}</b></div>
      <div><span>Buying saving / overrun <small>charged ${tk(T.goodsCharged)} vs actual</small></span><b>${sg(T.goodsCharged - T.goodsActual)}</b></div>
      <div><span>Zinc.com cost <small>$${T.zincUsd.toFixed(2)}</small></span><b>−${tk(T.zincBdt)}</b></div>
      <div><span>Other expenses</span><b>−${tk(T.expBdt)}</b></div>
      <div class="tot"><span>Net profit</span><b>${sg(T.net)}</b></div>
      <div><span>WOOW service fees earned</span><b>${tk(T.fee)}</b></div>
      <div><span>Shipping collected</span><b>${tk(T.shipCollected)}</b></div>
      <div><span>Shipping still to collect <small>second invoices</small></span><b>${tk(T.shipDue)}</b></div>
      <div><span>Orders waiting for payment</span><b>${tk(T.unpaid)}</b></div></div></div>
    <div class="card sec"><h3>Expenses by type</h3>${tbl(['Type', 'Amount'], Object.entries(d.byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${tk(v)}</td></tr>`).join('') + (T.zincBdt ? `<tr><td>Zinc.com (calls)</td><td>${tk(T.zincBdt)}</td></tr>` : ''))}</div>
  </div>
  <div class="card sec"><h3>Add expense</h3><div class="ef">
    <label>Date<input class="inp" id="eDay" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
    <label>Type<select class="inp" id="eCat">${EXP_CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
    <label>Amount<input class="inp" id="eAmt" inputmode="decimal"></label>
    <label>Currency<select class="inp" id="eCur"><option>BDT</option><option>USD</option></select></label>
    <label>Note<input class="inp" id="eNote" placeholder="e.g. Flight BDUS-261014, 42 kg"></label>
    <label>Order no. (optional)<input class="inp" id="eOrd" placeholder="WB-…"></label>
    <button class="btn dk" style="height:38px;margin:0;padding:0 18px" onclick="addExp()">Add</button></div>
    <div style="margin-top:12px">${tbl(['Date', 'Type', 'Amount', 'Note', ''], d.expenses.map((e) => `<tr><td>${esc(e.day)}</td><td>${esc(e.category)}</td><td>${e.currency === 'USD' ? '$' + e.amount.toFixed(2) : tk(e.amount)}</td><td>${esc(e.note || '')}${e.order_id ? ' · ' + esc(e.order_id) : ''}</td><td><button class="hb" style="height:28px;background:#F2F2F7;color:#D92D20" onclick="delExp(${e.id})">Delete</button></td></tr>`).join(''))}</div></div>
  <div class="card sec" style="overflow:auto"><h3>Orders <small>charged vs actual buying cost</small></h3>${tbl(['Order', 'Customer', 'Paid', 'Products charged', 'Actual cost', 'Saving', 'WOOW fee', 'Shipping due', 'Status'], d.rows.map((r) => `<tr><td><b>${r.id}</b><br><small>${new Date(r.at).toLocaleDateString()}</small></td><td>${esc(r.name || '')}<br><small>${esc(r.city || '')} · ${esc(r.stores.join(', '))}</small></td><td>${tk(r.paid)}</td><td>${tk(r.goodsCharged)}</td><td>${r.paid ? tk(r.goodsActual) + (r.estimated ? ' <small>est.</small>' : '') : '—'}</td><td>${r.diff === null ? '—' : sg(r.diff)}</td><td>${tk(r.fee)}</td><td>${r.shipDue ? tk(r.shipDue) : '—'}</td><td>${pill(r.status)}<br><small>${r.bought}/${r.items} bought</small></td></tr>`).join(''))}
    <p class="lead2" style="margin-top:8px">Actual cost comes from the Purchase sheet (“What did it actually cost?” when you mark Bought). Until then the charged price is used as an estimate.</p></div>`;
}
async function addExp() {
  try { await api('/api/admin/expenses', { day: $('eDay').value, category: $('eCat').value, amount: $('eAmt').value, currency: $('eCur').value, note: $('eNote').value, order: $('eOrd').value }); toast('Expense added'); loadMoney(); } catch (e) { toast(e.message); }
}
async function delExp(id) { if (!confirm('Delete this expense?')) return; await api(`/api/admin/expenses/${id}/delete`, {}); loadMoney(); }
function csvMoney() {
  if (!MONEY) return;
  const rows = [['Order', 'Date', 'Customer', 'City', 'Stores', 'Status', 'Paid BDT', 'Total BDT', 'Products charged BDT', 'Actual cost BDT', 'Estimated', 'Saving BDT', 'WOOW fee BDT', 'Shipping due BDT']];
  MONEY.rows.forEach((r) => rows.push([r.id, r.at.slice(0, 10), r.name, r.city, r.stores.join(' / '), r.status, r.paid, r.total, r.goodsCharged, r.goodsActual, r.estimated ? 'yes' : '', r.diff ?? '', r.fee, r.shipDue]));
  rows.push([]); rows.push(['Expense date', 'Type', 'Amount', 'Currency', 'Note', 'Order']);
  MONEY.expenses.forEach((e) => rows.push([e.day, e.category, e.amount, e.currency, e.note || '', e.order_id || '']));
  const text = rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' })); a.download = 'woow-money-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
}

// ───────── Customers: accounts, sign-in methods, open their portal ─────────
let cuT = null;
$('cuQ').oninput = () => { clearTimeout(cuT); cuT = setTimeout(loadCust, 300); };
async function loadCust() {
  const d = await api('/api/admin/users?q=' + encodeURIComponent($('cuQ').value.trim()));
  const b = (on, n) => `<span class="bdg ${on ? 'on' : ''}">${n}</span>`;
  $('cuRows').innerHTML = d.users.length ? d.users.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.disabled ? ' <span class="tagb no">Paused</span>' : ''}<br>${esc(u.phone)}<br><small style="color:#86868B">${esc(u.email || '')}${u.addresses.length ? ' · ' + u.addresses.length + ' address' + (u.addresses.length > 1 ? 'es' : '') : ''}</small></td>
    <td>${b(u.g, 'Google')}${b(u.a, 'Apple')}${b(u.w, 'WhatsApp')}${b(u.p, 'Password')}</td>
    <td><b>${u.orders}</b><br><small style="color:#86868B">${tk(u.paid)} paid</small></td>
    <td><small>${new Date(u.created_at).toLocaleDateString()}<br>${u.last_login ? new Date(u.last_login).toLocaleString() : '—'}</small></td>
    <td><div class="acts"><button class="op" onclick="portal('${u.id}')">Open portal ↗</button><button class="ps2" onclick="pause('${u.id}',${u.disabled ? 0 : 1})">${u.disabled ? 'Resume' : 'Pause'}</button><a class="hb" style="height:32px;background:#25D366;color:#fff;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/88${u.phone}">WhatsApp</a></div></td></tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:#86868B;padding:30px">No customers yet</td></tr>';
}
async function portal(id) { try { const d = await api(`/api/admin/users/${id}/portal`, {}); window.open(d.url, '_blank'); } catch (e) { toast(e.message); } }
async function pause(id, v) { if (v && !confirm('Pause this account? The customer can\'t sign in until you resume it.')) return; await api(`/api/admin/users/${id}/disable`, { disabled: v }); toast(v ? 'Paused' : 'Resumed'); loadCust(); }

load(); loadBuy().then(loadDash); setInterval(() => { load(); loadBuy(); if (!$('t-dash').hidden) loadDash(); }, 60000);
