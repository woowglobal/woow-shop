// WOOW Admin — orders, payments, Zinc purchasing, settings
const $ = (id) => document.getElementById(id);
const tk = (n) => '৳' + Math.round(n || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { awaiting_payment: '#C7C7CC', bank_review: '#FF9500', paid: '#34C759', purchasing: '#FFD400', purchased: '#007AFF', at_warehouse: '#5856D6', in_flight: '#5AC8FA', in_dhaka: '#AF52DE', delivered: '#1D1D1F', cancelled: '#8E8E93', problem: '#FF3B30' };
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
  <div class="kv"><span>Customer</span><b>${esc(o.customer.name)}</b><span>Mobile</span><b>${esc(o.phone)}</b><span>Email</span><b>${esc(o.customer.email || '—')}</b><span>Address</span><b>${esc(o.customer.address)}, ${esc(o.customer.city)}</b>
  <span>Plan</span><b>${o.plan === 'full' ? 'Pay all now' : 'Product now, shipping on arrival'}</b><span>Method</span><b>${esc(o.method)}${o.payment?.reference ? ' · ref ' + esc(o.payment.reference) : ''}</b>
  <span>Due / paid</span><b>${tk(o.amount_due)} / ${tk(o.amount_paid)}</b><span>Total</span><b>${tk(o.totals.total)} (rate ৳${o.totals.rate})</b>
  <span>Flight</span><b>${o.delivery ? o.delivery.flight + ' · ' + o.delivery.flightNo : '—'}</b></div>
  <h3 style="font-size:14px;margin:16px 0 6px">Items</h3>
  ${o.items.map((i) => `<div class="ci"><img src="${esc(i.image || '')}" alt=""><div><b>${esc(i.title)}</b><small>${esc(i.store)} · Qty ${i.qty} · $${i.lineUsd.toFixed(2)}${i.option ? ' · ' + esc(i.option) : ''}</small><br><a href="${esc(i.url)}" target="_blank" rel="noopener" style="font-size:12px;color:#0066CC">Open in store ↗</a></div><b>${tk(i.lineBdt)}</b></div>`).join('')}
  <h3 style="font-size:14px;margin:16px 0 6px">Store purchases (Zinc)</h3>
  ${z.length ? z.map((g) => `<div class="kv"><span>${esc(g.retailer)}</span><b>${esc(g.status)}${g.error ? ' · ⚠ ' + esc(g.error) : ''}</b><span>Zinc id</span><b style="font-size:11px">${esc(g.id)}</b><span>Store order</span><b>${esc((g.merchant_order_ids || []).join(', ') || '—')}</b><span>Tracking</span><b>${esc((g.tracking || []).map((t) => t.carrier + ' ' + t.number).join(', ') || '—')}</b></div>`).join('') : '<p style="color:#86868B;font-size:13px;margin:0">Not placed yet.</p>'}
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
async function act(id, a) {
  try { await api(`/api/admin/orders/${id}/${a}`, {}); toast('Done'); await load(); openO(id); } catch (e) { toast(e.message); }
}
async function setSt(id) {
  try { await api(`/api/admin/orders/${id}/status`, { status: $('ns').value, note: $('nn').value }); toast('Status updated'); await load(); openO(id); } catch (e) { toast(e.message); }
}

// settings
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
async function loadSet() {
  const { pricing: p } = await api('/api/admin/settings');
  $('sRate').value = p.rate; $('sFee').value = p.feePercent; $('sMin').value = p.minFee; $('sKg').value = p.kgRate; $('sDef').value = p.defaultKg; $('sLand').value = p.dhakaDaysAfterFlight;
  $('sDays').innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" ${p.flightDays.includes(i) ? 'checked' : ''}>${d}</label>`).join('');
}
async function saveSet() {
  const flightDays = [...$('sDays').querySelectorAll('input:checked')].map((x) => +x.value);
  try { await api('/api/admin/settings', { rate: $('sRate').value, feePercent: $('sFee').value, minFee: $('sMin').value, kgRate: $('sKg').value, defaultKg: $('sDef').value, dhakaDaysAfterFlight: $('sLand').value, flightDays }); toast('Settings saved'); } catch (e) { toast(e.message); }
}
document.querySelector('.tabs2').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.tabs2 button').forEach((x) => x.classList.toggle('on', x === b));
  $('t-orders').hidden = b.dataset.t !== 'orders'; $('t-settings').hidden = b.dataset.t !== 'settings';
  if (b.dataset.t === 'settings') loadSet();
});
load(); setInterval(load, 60000);
