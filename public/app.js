// WOOW Shop — storefront logic (plain JavaScript, no build step)
const $ = (id) => document.getElementById(id);
const tk = (n) => '৳' + Math.round(n).toLocaleString('en-US');
const usd = (c) => '$' + (c / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STORES = [
  { id: 'amazon', n: 'Amazon', l: 'a', c: '#FF9900', cats: ['Fashion', 'Electronics', 'Beauty', 'Health', 'Kids', 'Home'], url: 'https://www.amazon.com' },
  { id: 'walmart', n: 'Walmart', l: 'W', c: '#0071DC', cats: ['Fashion', 'Electronics', 'Beauty', 'Health', 'Kids', 'Home'], url: 'https://www.walmart.com' },
  { id: 'target', n: 'Target', l: '◎', c: '#CC0000', cats: ['Fashion', 'Electronics', 'Beauty', 'Kids', 'Home'], url: 'https://www.target.com' },
  { id: 'ebay', n: 'eBay', l: 'e', c: '#E53238', cats: ['Fashion', 'Electronics', 'Home'], url: 'https://www.ebay.com' },
  { id: 'bestbuy', n: 'Best Buy', l: 'BB', c: '#0046BE', cats: ['Electronics'], url: 'https://www.bestbuy.com' },
  { id: 'costco', n: 'Costco', l: 'C', c: '#E31837', cats: ['Electronics', 'Health', 'Home'], url: 'https://www.costco.com' },
  { id: 'macys', n: "Macy's", l: '★', c: '#E21A2C', cats: ['Fashion', 'Beauty', 'Home'], url: 'https://www.macys.com' },
  { id: 'nike', n: 'Nike', l: '✓', c: '#111111', cats: ['Fashion'], url: 'https://www.nike.com' },
  { id: 'sephora', n: 'Sephora', l: 'S', c: '#000000', cats: ['Beauty'], url: 'https://www.sephora.com' },
  { id: 'ulta', n: 'Ulta', l: 'U', c: '#F26B3A', cats: ['Beauty'], url: 'https://www.ulta.com' },
  { id: 'iherb', n: 'iHerb', l: 'i', c: '#458500', cats: ['Health', 'Beauty'], url: 'https://www.iherb.com' },
  { id: 'carters', n: "Carter's", l: 'c', c: '#00A3E0', cats: ['Kids', 'Fashion'], url: 'https://www.carters.com' },
];
const CAT_WORD = { Fashion: 'clothing', Electronics: 'electronics', Beauty: 'beauty skincare makeup', Health: 'vitamins supplements', Kids: 'kids toys', Home: 'home kitchen' };
let cat = 'All';
let CFG = null, RESULTS = [], cur = null, qty = 1, store = 'all', plan = 'full', method = 'bkash', lastQuote = null;
let CART = load();

function load() { try { return JSON.parse(localStorage.getItem('woowCart') || '[]'); } catch { return []; } }
function save() { try { localStorage.setItem('woowCart', JSON.stringify(CART)); } catch {} $('cc').textContent = CART.reduce((a, x) => a + x.qty, 0); }
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(window._t); window._t = setTimeout(() => e.classList.remove('on'), 1800); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}

// ── local estimate (the server always re-checks the final price) ──
function est(p, n = 1) {
  const item = (p.priceCents / 100) * n * CFG.rate;
  const fee = Math.max(CFG.minFee, item * CFG.feePercent / 100);
  const kg = Math.ceil((p.kg || CFG.defaultKg) * n * 10) / 10;
  const ship = kg * CFG.kgRate;
  return { item, fee, kg, ship, total: item + fee + ship };
}

// ── delivery plan ──
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = (s) => new Date(s + 'T12:00:00');
const fd = (d) => WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()];
const fr = (a, b) => a.getMonth() === b.getMonth() ? WD[a.getDay()] + ' ' + a.getDate() + ' – ' + WD[b.getDay()] + ' ' + b.getDate() + ' ' + MO[b.getMonth()] : fd(a) + ' – ' + fd(b);
const sName = (r) => (STORES.find((s) => s.id === r) || CFG.stores.find((s) => s.id === r) || {}).n || (CFG.stores.find((s) => s.id === r) || {}).name || r;
function planHtml(p) {
  if (!p) return '';
  const multi = p.stores.length > 1;
  return `<div class="dp"><div class="dp-h"><b>Delivery plan</b><span>≈ ${p.leadDays} days lead time</span></div><ol class="dpl">
  <li><i></i><span>GENI buys from ${multi ? 'the stores' : esc(sName(p.stores[0].retailer))}</span><b>${fd(D(p.buy))}</b></li>
  <li><i></i><span>WOOW US warehouse receives<small>Store ships to our Delaware warehouse</small></span><b>${fd(D(p.warehouse))}</b>${multi ? '<div class="dps">' + p.stores.map((s) => `<div><span>${esc(sName(s.retailer))}</span><b>${fr(D(s.from), D(s.to))}</b></div>`).join('') + '</div>' : ''}</li>
  <li class="fl"><i>✈</i><span>WOOW flight<small>${p.flightNo} · USA → Dhaka</small></span><b>${fd(D(p.flight))}</b></li>
  <li><i></i><span>Lands in Dhaka, customs cleared</span><b>${fd(D(p.land))}</b></li>
  <li class="end"><i>✓</i><span>Delivered to you</span><b>${fr(D(p.deliverFrom), D(p.deliverTo))}</b></li></ol>
  <p>Estimates. If a store ships late, your box goes on the next WOOW flight.</p></div>`;
}
function localPlan(retailers) {
  const day = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const t0 = new Date(); t0.setHours(12, 0, 0, 0); const buy = day(t0, 1);
  const stores = [...new Set(retailers)].map((r) => { const [a, b] = CFG.transitDays[r] || CFG.transitDays.default; return { retailer: r, from: day(buy, a), to: day(buy, b) }; });
  const wh = stores.reduce((m, s) => (s.to > m ? s.to : m), buy);
  let fl = day(wh, 1); for (let i = 0; i < 14 && !CFG.flightDays.includes(fl.getDay()); i++) fl = day(fl, 1);
  const land = day(fl, CFG.dhakaDaysAfterFlight), d2 = day(land, 2);
  return { buy: ymd(buy), stores: stores.map((s) => ({ retailer: s.retailer, from: ymd(s.from), to: ymd(s.to) })), warehouse: ymd(wh), flight: ymd(fl), flightNo: 'BDUS-' + ymd(fl).slice(2).replace(/-/g, ''), land: ymd(land), deliverFrom: ymd(day(land, 1)), deliverTo: ymd(d2), leadDays: Math.round((d2 - t0) / 864e5) };
}

// ── browse ──
function card(p) {
  const c = est(p);
  return `<button class="pc" data-u="${esc(p.url)}"><div class="pim"><span class="chip">${esc(p.store)}</span>${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}</div>
  <div class="pb"><div class="nm">${esc(p.title)}</div>${p.stars ? `<div class="st">★ ${p.stars} <span>(${(p.reviews || 0).toLocaleString('en-US')})</span></div>` : ''}
  <div class="bd">${tk(c.total)}</div><div class="us">${usd(p.priceCents)} at ${esc(p.store)}</div><span class="tg">Delivered to Dhaka</span></div></button>`;
}
async function doSearch() {
  const typed = $('q').value.trim(), q = typed || (cat !== 'All' ? CAT_WORD[cat] : '');
  const sn = store !== 'all' ? (STORES.find((x) => x.id === store) || {}).n : '';
  $('rt').textContent = typed ? `Results for “${typed}”${sn ? ' at ' + sn : ''}` : (cat !== 'All' ? cat : 'Popular right now') + (sn ? ' at ' + sn : '');
  $('grid').innerHTML = '<div class="skel"></div>'.repeat(8); $('rn').textContent = 'Searching…';
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}&store=${searchable(store) ? store : 'all'}`);
    RESULTS = d.results;
    $('rn').textContent = RESULTS.length + ' results';
    $('grid').innerHTML = RESULTS.length ? RESULTS.map(card).join('') : '<div class="card empty">No matches. Try another word, or paste a product link.</div>';
  } catch (e) { $('grid').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; $('rn').textContent = ''; }
}
async function doLink() {
  const url = $('lnk').value.trim(); if (!url) return;
  try { const d = await api('/api/link', { url }); RESULTS = [d.product, ...RESULTS]; openItem(d.product); }
  catch (e) { toast(e.message); }
}
$('grid').addEventListener('click', (e) => { const b = e.target.closest('.pc'); if (b) openItem(RESULTS.find((p) => p.url === b.dataset.u)); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
$('lnk').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLink(); });
function setMode(m) {
  [...$('mode').children].forEach((x) => x.classList.toggle('on', x.dataset.m === m));
  $('searchBox').hidden = m !== 'search'; $('linkBox').hidden = m !== 'link';
  (m === 'link' ? $('lnk') : $('q')).focus({ preventScroll: true });
}
$('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
const searchable = (id) => CFG.stores.some((s) => s.id === id);
function drawCats() {
  $('cats').innerHTML = ['All', ...Object.keys(CAT_WORD)].map((c) => `<button class="cat ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  const L = STORES.filter((s) => cat === 'All' || s.cats.includes(cat));
  $('tiles').innerHTML = L.map((s) => `<button class="tile ${store === s.id ? 'on' : ''}" data-st="${s.id}"><i style="background:${s.c}">${s.l}</i>${esc(s.n)}${searchable(s.id) ? '' : '<em>paste link</em>'}</button>`).join('');
}
$('cats').addEventListener('click', (e) => {
  const b = e.target.closest('.cat'); if (!b) return;
  cat = b.dataset.c; if (store !== 'all' && !(STORES.find((s) => s.id === store)?.cats.includes(cat) || cat === 'All')) store = 'all';
  drawCats(); doSearch();
});
$('tiles').addEventListener('click', (e) => {
  const b = e.target.closest('.tile'); if (!b) return;
  const s = STORES.find((x) => x.id === b.dataset.st);
  if (searchable(s.id)) { store = store === s.id ? 'all' : s.id; drawCats(); doSearch(); document.querySelector('.rh').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  // stores without search: open the store, customer pastes the product link back here
  window.open(s.url, '_blank', 'noopener'); setMode('link');
  $('hint').innerHTML = `<b>${esc(s.n)}</b> opened in a new tab. Copy the product link from there and paste it above, then tap “Get price”.`;
});

// ── product ──
function openItem(p) {
  if (!p) return; cur = p; qty = 1; $('dQ').textContent = 1; $('dOpt').value = '';
  $('dImg').src = p.image || ''; $('dNm').textContent = p.title; $('dLink').href = p.url.startsWith('https://demo.') ? '#' : p.url;
  $('dSrc').innerHTML = `<b>${esc(p.store)}</b>Sold and shipped in the USA`;
  $('dSt').innerHTML = p.stars ? `★ ${p.stars} <span>(${(p.reviews || 0).toLocaleString('en-US')} ratings)</span>` : '';
  upd(); go('item');
}
function q(d) { qty = Math.max(1, Math.min(9, qty + d)); $('dQ').textContent = qty; upd(); }
function upd() {
  const c = est(cur, qty);
  $('dBd').textContent = tk(c.total); $('dUs').textContent = `${usd(cur.priceCents * qty)} at ${cur.store} · rate ৳${CFG.rate}`;
  $('dBrk').innerHTML = `<div><span>Product price<small>${usd(cur.priceCents * qty)} × ৳${CFG.rate}</small></span><b>${tk(c.item)}</b></div>
  <div><span>US sales tax<small>Our Delaware warehouse</small></span><b class="free">৳0</b></div>
  <div><span>WOOW buying service<small>${CFG.feePercent}%, minimum ৳${CFG.minFee}</small></span><b>${tk(c.fee)}</b></div>
  <div><span>Shipping &amp; customs to Dhaka<small>Est. ${c.kg} kg × ৳${CFG.kgRate.toLocaleString('en-US')}</small></span><b>${tk(c.ship)}</b></div>`;
  $('dPlan').innerHTML = planHtml(localPlan([cur.retailer]));
}
function addCart(show) {
  const option = $('dOpt').value.trim();
  const ex = CART.find((x) => x.url === cur.url && x.option === option);
  if (ex) ex.qty = Math.min(9, ex.qty + qty);
  else CART.push({ url: cur.url, qty, option, retailer: cur.retailer, store: cur.store, title: cur.title, image: cur.image, priceCents: cur.priceCents, kg: cur.kg || null });
  save(); if (show) toast('✓ Added to cart');
}

// ── cart + checkout (server quote) ──
async function getQuote() {
  if (!CART.length) return null;
  const d = await api('/api/quote', { items: CART.map(({ url, qty, option }) => ({ url, qty, option })) });
  lastQuote = d; return d;
}
function sumHtml(d, btn) {
  const t = d.quote;
  return `<div class="tt">Order total</div>
  <div class="row" style="margin-top:8px"><span>Products (${'$' + t.usd.toFixed(2)})</span><b>${tk(t.product)}</b></div>
  <div class="row"><span>US sales tax</span><b class="free">৳0</b></div>
  <div class="row"><span>WOOW buying service</span><b>${tk(t.fee)}</b></div>
  <div class="row"><span>Shipping &amp; customs · est. ${t.kg} kg</span><b>${tk(t.shipping)}</b></div>
  <div class="tot"><span>Total</span><b>${tk(t.total)}</b></div>${btn}${planHtml(d.delivery)}`;
}
async function rCart() {
  save();
  if (!CART.length) { $('cGroups').innerHTML = '<div class="card empty">Your cart is empty.</div>'; $('cSum').innerHTML = '<button class="btn" onclick="go(\'browse\')">Start shopping</button>'; return; }
  const G = {}; CART.forEach((x, i) => (G[x.store] ||= []).push([x, i]));
  $('cGroups').innerHTML = Object.keys(G).map((s) => `<div class="card sg"><h4><span class="chip" style="position:static">${esc(s)}</span>${G[s].length} item${G[s].length > 1 ? 's' : ''}</h4>` +
    G[s].map(([x, i]) => `<div class="ci"><img src="${esc(x.image || '')}" alt=""><div><b>${esc(x.title)}</b><small>${x.option ? esc(x.option) + ' · ' : ''}Qty ${x.qty} · ${usd(x.priceCents * x.qty)}</small><br><button class="rm" onclick="rmv(${i})">Remove</button></div><div style="text-align:right"><b>${tk(x.priceCents / 100 * x.qty * CFG.rate)}</b><br><small>+ fees &amp; shipping</small></div></div>`).join('') + '</div>').join('') +
    '<div class="card sec" style="display:flex;gap:12px;align-items:center"><span style="font-size:22px">📦</span><div><b style="font-size:13.5px">Different stores, one box</b><div style="color:#86868B;font-size:12px">We collect everything at our US warehouse and fly it together.</div></div></div>';
  $('cSum').innerHTML = '<div class="tt">Calculating…</div>';
  try { const d = await getQuote(); $('cSum').innerHTML = sumHtml(d, '<button class="btn dk" style="margin-top:14px" onclick="go(\'pay\')">Checkout in Taka →</button>'); }
  catch (e) { $('cSum').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div>`; }
}
function rmv(i) { CART.splice(i, 1); rCart(); }
async function rPay() {
  if (!CART.length) return go('browse');
  $('pSum').innerHTML = '<div class="tt">Calculating…</div>';
  let d; try { d = await getQuote(); } catch (e) { $('pSum').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div>`; return; }
  drawPay(d);
}
function drawPay(d) {
  const t = d.quote, now = plan === 'full' ? t.total : t.payNowSplit;
  $('pFull').textContent = tk(t.total); $('pSplit').textContent = tk(t.payNowSplit) + ' now';
  const ml = { bkash: 'bKash', nagad: 'Nagad', card: 'card', bank: 'bank transfer' }[method];
  $('pSum').innerHTML = sumHtml(d, `<div class="now"><span>Pay now</span><b>${tk(now)}</b></div>${plan === 'split' ? `<div class="row"><span>On arrival in Dhaka</span><b>${tk(t.shipping)}</b></div>` : ''}
   <button class="btn dk" id="payBtn" style="margin-top:12px" onclick="placeOrder()">Pay ${tk(now)} with ${ml}</button><div class="err" id="pErr"></div>
   <p class="note">✓ We re-check the store price when you press Pay. Rate $1 = ৳${t.rate}. By paying you agree WOOW buys these items for you from US stores. Final shipping is based on actual weight.</p>`);
}
$('plan').addEventListener('click', (e) => { const b = e.target.closest('.op'); if (!b) return; $('plan').querySelectorAll('.op').forEach((x) => x.classList.toggle('on', x === b)); plan = b.dataset.v; if (lastQuote) drawPay(lastQuote); });
$('pm').addEventListener('click', (e) => { const b = e.target.closest('.op'); if (!b) return; $('pm').querySelectorAll('.op').forEach((x) => x.classList.toggle('on', x === b)); method = b.dataset.m; if (lastQuote) drawPay(lastQuote); });
async function placeOrder() {
  const btn = $('payBtn'); $('pErr').style.display = 'none'; btn.disabled = true; btn.textContent = 'Checking today\'s store price…';
  const customer = { name: $('cName').value, phone: $('cPhone').value, email: $('cEmail').value, city: $('cCity').value, address: $('cAddr').value };
  try { localStorage.setItem('woowCustomer', JSON.stringify(customer)); } catch {}
  const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer, plan, method, expectedTotal: lastQuote?.quote?.total, items: CART.map(({ url, qty, option }) => ({ url, qty, option })) }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 409 && d.error === 'price_changed') {
    // store price moved: show the new price, customer presses Pay again
    lastQuote = { quote: d.quote, delivery: d.delivery };
    d.quote.lines.forEach((l) => CART.filter((c) => c.url === l.url).forEach((c) => { c.priceCents = l.priceCents; c.title = l.title; }));
    save(); drawPay(lastQuote);
    const e = $('pErr'); e.className = 'err warn'; e.textContent = d.message; e.style.display = 'block';
    return;
  }
  if (!r.ok) { drawPay(lastQuote); $('pErr').textContent = d.error || 'Something went wrong'; $('pErr').style.display = 'block'; return; }
  CART = []; save();
  const phone = encodeURIComponent(customer.phone.replace(/\D/g, '').replace(/^880/, '0'));
  if (d.next.type === 'redirect') location.href = d.next.url;
  else location.href = `/order?id=${d.orderId}&phone=${phone}&bank=1`;
}

// ── navigation ──
function go(v) {
  document.querySelectorAll('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  if (v === 'cart') rCart(); if (v === 'pay') rPay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (history.state?.v !== v) history.pushState({ v }, '', v === 'browse' ? '/' : '#' + v);
}
window.addEventListener('popstate', (e) => go(e.state?.v || 'browse'));

(async function init() {
  CFG = await api('/api/config');
  $('rateTx').textContent = `$1 = ৳${CFG.rate}`; drawCats();
  if (CFG.demo.zinc || CFG.demo.payments) { $('demoBar').hidden = false; $('demoBar').textContent = 'DEMO MODE · ' + [CFG.demo.zinc && 'sample products', CFG.demo.payments && 'test payments'].filter(Boolean).join(' · ') + ' · add your keys in Cloudflare (Settings → Variables and Secrets) to go live'; }
  try { const c = JSON.parse(localStorage.getItem('woowCustomer') || 'null'); if (c) { $('cName').value = c.name || ''; $('cPhone').value = c.phone || ''; $('cEmail').value = c.email || ''; $('cCity').value = c.city || 'Dhaka'; $('cAddr').value = c.address || ''; } } catch {}
  save(); doSearch();
  const h = location.hash.slice(1); if (h === 'cart' || h === 'pay') go(h);
})();
