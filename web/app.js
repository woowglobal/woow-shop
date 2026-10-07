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
// Store pages: colours echo each store, rows are live Zinc searches (cached 30 min).
const THEME = {
  amazon: { sb: '#131921', sf: '#fff', sa: '#FF9900', sat: '#131921', sh: '#E3F0FF', hero: ['Today\'s picks', 'best sellers'], rows: [['Beauty & skincare', 'skincare'], ['Headphones & audio', 'headphones'], ['Vitamins & health', 'vitamins'], ['Home & kitchen', 'kitchen'], ['Fashion', 'women fashion'], ['Kids & toys', 'toys']] },
  walmart: { sb: '#0071DC', sf: '#fff', sa: '#FFC220', sat: '#1D1D1F', sh: '#E6F1FC', hero: ['Top deals', 'deals'], rows: [['Electronics', 'headphones'], ['Home', 'home'], ['Beauty', 'beauty'], ['Toys', 'toys'], ['Clothing', 'clothing'], ['Health', 'vitamins']] },
  target: { sb: '#FFFFFF', sf: '#1D1D1F', sa: '#CC0000', sat: '#fff', sh: '#DDF5F5', light: true, hero: ['Trending now', 'best sellers'], rows: [['Beauty', 'beauty'], ['Home', 'home decor'], ['Toys', 'toys'], ['Clothing', 'clothing'], ['Health', 'vitamins'], ['Tech', 'headphones']] },
  macys: { sb: '#000000', sf: '#fff', sa: '#E21A2C', sat: '#fff', sh: '#F6E9EA', hero: ['Signature picks', 'women'], rows: [['Women', 'women dresses'], ['Men', 'men shirts'], ['Beauty & fragrance', 'perfume'], ['Shoes', 'shoes'], ['Handbags', 'handbags'], ['Home', 'bedding']] },
  bestbuy: { sb: '#0046BE', sf: '#fff', sa: '#FFE000', sat: '#1D1D1F', sh: '#E8EEFB', hero: ['Top deals', 'deals'], rows: [['Headphones', 'headphones'], ['Laptops', 'laptop'], ['TV & home theater', 'tv'], ['Phones & tablets', 'tablet'], ['Gaming', 'gaming'], ['Smart home', 'smart home']] },
};
let curStore = null;
const CAT_WORD = { Fashion: 'clothing', Electronics: 'electronics', Beauty: 'beauty skincare makeup', Health: 'vitamins supplements', Kids: 'kids toys', Home: 'home kitchen' };
let cat = 'All';
let CFG = null, RESULTS = [], cur = null, qty = 1, store = 'all', plan = 'split', method = 'bkash', lastQuote = null;
let CART = load();

function load() { try { return JSON.parse(localStorage.getItem('woowCart') || '[]'); } catch { return []; } }
function save() { try { localStorage.setItem('woowCart', JSON.stringify(CART)); } catch {} $('cc').textContent = CART.reduce((a, x) => a + x.qty, 0); }
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(window._t); window._t = setTimeout(() => e.classList.remove('on'), 1800); }
// anonymous visitor id (for the WOOW dashboard: searches, views, orders per visitor and city)
const SID = (() => { try { let x = localStorage.getItem('woowSid'); if (!x) { x = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('woowSid', x); } return x; } catch { return 'nosid'; } })();
// where this visitor came from (utm_source / referrer: facebook, tiktok, instagram…) — used for social trends
const REF = (() => { try { const u = new URL(location.href).searchParams.get('utm_source') || (document.referrer ? new URL(document.referrer).hostname : ''); const m = String(u).toLowerCase().match(/facebook|fb|instagram|tiktok|youtube|whatsapp|messenger/); const r = m ? m[0] : ''; if (r) localStorage.setItem('woowRef', r); return r || localStorage.getItem('woowRef') || ''; } catch { return ''; } })();
function beacon(type, p = {}) { try { fetch('/api/t', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, sid: SID, url: p.url, store: p.retailer, title: p.title, price: p.priceCents, ref: type === 'visit' ? REF : undefined }) }); } catch {} }
function rememberSearch(q) { q = String(q || '').trim(); if (!q) return; try { const L = JSON.parse(localStorage.getItem('woowSearches') || '[]').filter((x) => x !== q); L.unshift(q); localStorage.setItem('woowSearches', JSON.stringify(L.slice(0, 20))); } catch {} }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sid': SID }, body: JSON.stringify(body) } : { headers: { 'x-sid': SID } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.error === 'login') { ME = null; drawMe(); openAuth(); throw new Error('Please sign in first.'); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}

// ── accounts: browsing is open; cart, checkout and price requests need sign-in ──
let ME = null, AFTER = null, AMODE = 'in';
function drawMe() { $('acctN').textContent = ME ? ME.name.split(' ')[0] : 'Sign in'; }
function acct() { if (!ME) return openAuth(); $('meN').textContent = ME.name; $('meP').textContent = ME.phone + (ME.email ? ' · ' + ME.email : ''); $('meM').hidden = false; }
function needLogin(fn, why) { if (ME) return fn(); AFTER = fn; openAuth(why); }
function openAuth(why) {
  $('aWhy').textContent = why || 'Sign in to add to cart and pay in Taka.';
  $('aErr').style.display = 'none'; setAMode(AMODE);
  $('aWa').href = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent('Hi WOOW, I forgot my WOOW Shop password.')}`;
  $('authM').hidden = false; setTimeout(() => $(AMODE === 'up' ? 'aName' : 'aPhone').focus(), 50);
}
function closeAuth() { $('authM').hidden = true; AFTER = null; }
function setAMode(mo) {
  AMODE = mo; [...$('aTabs').children].forEach((b) => b.classList.toggle('on', b.dataset.a === mo));
  $('aNameL').hidden = $('aEmailL').hidden = mo !== 'up';
  $('aT').textContent = mo === 'up' ? 'Create your WOOW account' : 'Sign in'; $('aBtn').textContent = mo === 'up' ? 'Create account' : 'Sign in';
  $('aPass').autocomplete = mo === 'up' ? 'new-password' : 'current-password';
}
$('aTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setAMode(b.dataset.a); });
$('aPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
async function doAuth() {
  const btn = $('aBtn'); btn.disabled = true; $('aErr').style.display = 'none';
  try {
    const d = await api('/api/auth/' + (AMODE === 'up' ? 'signup' : 'login'), { name: $('aName').value, phone: $('aPhone').value, email: $('aEmail').value, password: $('aPass').value });
    ME = d.user; drawMe(); $('authM').hidden = true; $('aPass').value = '';
    toast('✓ Welcome, ' + ME.name.split(' ')[0]);
    const f = AFTER; AFTER = null; if (f) f();
  } catch (e) { $('aErr').textContent = e.message; $('aErr').style.display = 'block'; }
  btn.disabled = false;
}
async function signOut() { await api('/api/auth/logout', {}).catch(() => {}); ME = null; drawMe(); $('meM').hidden = true; go('browse'); toast('Signed out'); }

// ── local estimate (the server always re-checks the final price) ──
// US delivery store → WOOW warehouse: free over the store's limit, else Zinc's real fee or the store rule
function usShip(retailer, subCents, shipCents) {
  const r = (CFG.usShipping || {})[retailer] || (CFG.usShipping || {}).default || { freeOver: 35, fee: 7.99 };
  if (subCents >= r.freeOver * 100) return { c: 0, free: true, r };
  return { c: Number.isFinite(shipCents) ? shipCents : Math.round(r.fee * 100), r, need: Math.max(0, r.freeOver * 100 - subCents) };
}
function est(p, n = 1) {
  const sub = p.priceCents * n, item = (sub / 100) * CFG.rate;
  const s = usShip(p.retailer, sub, p.shipCents);
  const usD = (s.c / 100) * CFG.rate, tax = ((sub + s.c) / 100) * (CFG.taxRate || 0) / 100 * CFG.rate;
  const fee = Math.max(CFG.minFee, item * CFG.feePercent / 100);
  const sellerKg = Math.round((p.kg || CFG.defaultKg) * n * 100) / 100;
  const kg = Math.ceil(sellerKg * (1 + CFG.packagingPercent / 100) * 10) / 10; // + courier box
  const ship = kg * CFG.kgRate, now = item + usD + tax + fee;
  return { item, s, usD, tax, fee, sellerKg, kg, ship, now, total: now + ship, listed: !!p.kg };
}
const taxNote = () => CFG.taxRate ? `${CFG.taxRate}% · ${CFG.warehouseState === 'NY' ? 'New York' : CFG.warehouseState} warehouse` : 'Delaware warehouse · tax-free';
const shipNote = (s) => s.free ? `Free over $${s.r.freeOver}` : `${usd(s.c)} · add ${usd(s.need)} for free`;
const storeLink = (p) => p.url && !p.url.startsWith('https://demo.') && !p.url.includes('#') ? p.url : null;

// Most searched in Bangladesh (WOOW's experience) — home circles, trending chips and product rails
const BD_POP = [['💊', 'Supplements', 'supplements'], ['🍊', 'Vitamins', 'vitamins'], ['💄', 'Cosmetics', 'cosmetics makeup'], ['⌚', 'Watches', 'watch'],
  ['👜', 'Ladies bags', 'women handbag'], ['👟', 'Shoes', 'shoes'], ['💻', 'Laptops', 'laptop'], ['🐾', 'Pet food', 'pet food'],
  ['🧸', 'Toys', 'toys'], ['🚁', 'Drones', 'mini drone camera'], ['💪', 'Gym supplements', 'whey protein'], ['📱', 'Used iPad', 'ipad renewed']];
let popObs = null;
function drawPopRails() {
  $('feed3').innerHTML = BD_POP.map(([ic, n, q], i) => `<div class="srow fd" data-q="${esc(q)}"><div class="row-h"><div><b>${ic} ${esc(n)}</b><small>Popular in Bangladesh</small></div><button data-tq="${esc(q)}">See all →</button></div><div class="rail">${'<div class="skel"></div>'.repeat(5)}</div></div>`).join('');
  if (popObs) popObs.disconnect();
  popObs = new IntersectionObserver((ents) => ents.forEach(async (en) => {
    if (!en.isIntersecting) return; popObs.unobserve(en.target);
    const rail = en.target.querySelector('.rail');
    try { const L = await fetchRow('all', en.target.dataset.q, true); rail.innerHTML = L.length ? L.slice(0, 14).map((p) => card(p)).join('') : '<div class="row-empty">Nothing here right now.</div>'; }
    catch { en.target.remove(); }
  }), { rootMargin: '200px' });
  $('feed3').querySelectorAll('.srow').forEach((r) => popObs.observe(r));
}

// ── Recommended for you: device history + similar shoppers + social trend (server ranks; no paid lookups) ──
async function loadForYou() {
  let L = []; try { L = JSON.parse(localStorage.getItem('woowSearches') || '[]'); } catch {}
  const R = rvLoad();
  let d; try { d = await api('/api/foryou', { recent: R.map((x) => x.url), titles: R.map((x) => x.title).slice(0, 12), cart: CART.map((x) => x.url), searches: L, ref: REF }); } catch { return; }
  if (!d.items?.length) { $('fy').innerHTML = ''; return; }
  const name = ME ? ME.name.split(' ')[0] + ', picked for you' : 'Picked for you';
  $('fy').innerHTML = `<div class="srow fd fyr"><div class="row-h"><div><b>✨ ${esc(name)}</b><small>${d.personal ? 'Based on what you searched and viewed, and what shoppers like you bought' : 'What shoppers in Bangladesh love right now'}${d.topics?.length ? ' · ' + d.topics.slice(0, 3).map(esc).join(', ') : ''}</small></div></div><div class="rail">${remember(d.items).map((p) => card(p, esc(p.why))).join('')}</div></div>`;
}

// ── home feed: what Bangladeshi shoppers searched, viewed and bought (WOOW's own data → no Zinc cost) ──
const since = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
async function loadFeed() {
  let d; try { d = await api('/api/feed'); } catch { return; }
  const rail = (title, sub, list, tag) => list.length ? `<div class="srow fd"><div class="row-h"><div><b>${title}</b><small>${sub}</small></div></div><div class="rail">${remember(list).map((p) => card(p, tag(p))).join('')}</div></div>` : '';
  const tq = [...new Set([...d.searches, ...BD_POP.map((x) => x[1].toLowerCase())])].slice(0, 14);
  $('feed').innerHTML = `<div class="bdc"><div class="row-h"><div><b>🇧🇩 Most searched in Bangladesh</b></div></div><div class="bdl">${BD_POP.map(([ic, n, q]) => `<button data-tq="${esc(q)}"><i>${ic}</i>${esc(n)}</button>`).join('')}</div></div>` +
    `<div class="trend"><b>🔥 Trending</b>${tq.map((q) => `<button data-tq="${esc((BD_POP.find((x) => x[1].toLowerCase() === q) || [0, 0, q])[2])}">${esc(q)}</button>`).join('')}</div>` +
    rail('🇧🇩 Just bought in Bangladesh', 'Real WOOW orders', d.bought, (p) => `${esc(p.city)} · ${since(p.at)}`) +
    rail('⭐ Most popular', 'Loved by WOOW shoppers', d.popular, (p) => p.sold ? `🔥 ${p.sold} bought` : 'Popular in Bangladesh');
  $('feed2').innerHTML = rail('✨ New today', 'Found by other shoppers in the last 24 h', d.fresh, () => 'New today');
  drawPopRails();
}
document.addEventListener('click', (e) => { const t = e.target.closest('[data-tq]'); if (t) { setMode('search'); $('q').value = t.dataset.tq; doSearch(); $('rt').scrollIntoView({ behavior: 'smooth' }); } });

// ── recently viewed: kept in this browser only, so showing them costs no Zinc calls ──
const RV_MAX = 12;
function rvLoad() { try { return JSON.parse(localStorage.getItem('woowRecent') || '[]'); } catch { return []; } }
function rvAdd(p) {
  const L = rvLoad().filter((x) => x.url !== p.url);
  L.unshift({ url: p.url, retailer: p.retailer, store: p.store, title: p.title, image: p.image && p.image.length < 3000 ? p.image : null, priceCents: p.priceCents, kg: p.kg || null, stars: p.stars, reviews: p.reviews, at: Date.now() });
  try { localStorage.setItem('woowRecent', JSON.stringify(L.slice(0, RV_MAX))); } catch {}
}
function rvDraw() {
  const L = rvLoad();
  for (const [id, skip] of [['rvB', null], ['rvD', cur && document.querySelector('#v-item.on') ? cur.url : null], ['rvC', null]]) {
    const el = $(id); if (!el) continue;
    const list = L.filter((x) => x.url !== skip).slice(0, 8);
    el.hidden = !list.length;
    if (!list.length) { el.innerHTML = ''; continue; }
    el.innerHTML = `<div class="rv-h"><b>Recently viewed</b><button onclick="rvClear()">Clear</button></div><div class="rv-l">` + list.map((p) => {
      SEEN.has(p.url) || SEEN.set(p.url, p);
      return `<div class="rvi" data-rv="${esc(p.url)}"><img src="${esc(p.image || '')}" alt="" loading="lazy"><div><small>${esc(p.store)}</small><span>${esc(p.title)}</span><b>${tk(est(p).total)}</b></div><button class="rv-add" data-rva="${esc(p.url)}" aria-label="Add to cart">+</button></div>`;
    }).join('') + '</div>';
  }
}
function rvClear() { try { localStorage.removeItem('woowRecent'); } catch {} rvDraw(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-rva]'); if (a) { const p = rvLoad().find((x) => x.url === a.dataset.rva); if (p) { SEEN.set(p.url, p); cmpCart(p.url); } return; }
  const r = e.target.closest('[data-rv]'); if (r) { const p = rvLoad().find((x) => x.url === r.dataset.rv); if (p) { beacon('recent', p); openItem(SEEN.get(p.url) || p); } }
});

// ── delivery plan ──
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const D = (s) => new Date(s + 'T12:00:00');
const fd = (d) => WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()];
const fr = (a, b) => a.getMonth() === b.getMonth() ? WD[a.getDay()] + ' ' + a.getDate() + ' – ' + WD[b.getDay()] + ' ' + b.getDate() + ' ' + MO[b.getMonth()] : fd(a) + ' – ' + fd(b);
const sName = (r) => (STORES.find((s) => s.id === r) || CFG.stores.find((s) => s.id === r) || {}).n || (CFG.stores.find((s) => s.id === r) || {}).name || r;
function planHtml(p, pickup) {
  if (!p) return '';
  const multi = p.stores.length > 1;
  return `<div class="dp"><div class="dp-h"><b>Delivery plan</b><span>≈ ${p.leadDays} days lead time</span></div><ol class="dpl">
  <li><i></i><span>GENI buys from ${multi ? 'the stores' : esc(sName(p.stores[0].retailer))}</span><b>${fd(D(p.buy))}</b></li>
  <li><i></i><span>WOOW US warehouse receives<small>Store ships to our Delaware warehouse</small></span><b>${fd(D(p.warehouse))}</b>${multi ? '<div class="dps">' + p.stores.map((s) => `<div><span>${esc(sName(s.retailer))}</span><b>${fr(D(s.from), D(s.to))}</b></div>`).join('') + '</div>' : ''}</li>
  <li class="fl"><i>✈</i><span>WOOW flight<small>${p.flightNo} · USA → Dhaka</small></span><b>${fd(D(p.flight))}</b></li>
  <li><i></i><span>Lands in Dhaka, customs cleared</span><b>${fd(D(p.land))}</b></li>
  <li class="end"><i>✓</i><span>${pickup ? 'Ready to pick up at WOOW office<small>Baridhara DOHS · 10 AM – 6 PM, closed Fri</small>' : 'Delivered to you'}</span><b>${fr(D(p.deliverFrom), D(p.deliverTo))}</b></li></ol>
  <p>Estimates. If a store ships late, your box goes on the next WOOW flight.</p></div>`;
}
function localPlan(retailers) {
  const day = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const t0 = new Date(); t0.setHours(12, 0, 0, 0); const buy = day(t0, 1);
  const stores = [...new Set(retailers)].map((r) => { const [a, b] = CFG.transitDays[r] || CFG.transitDays.default; return { retailer: r, from: day(buy, a), to: day(buy, b) }; });
  const wh = stores.reduce((m, s) => (s.to > m ? s.to : m), buy);
  const after = ymd(day(wh, 1)), nf = (CFG.flights || []).find((f) => f.date >= after); // WOOW flight schedule from the server
  const fl = nf ? new Date(nf.date + 'T12:00:00') : day(wh, 10);
  const land = day(fl, CFG.dhakaDaysAfterFlight), d2 = day(land, 2);
  return { buy: ymd(buy), stores: stores.map((s) => ({ retailer: s.retailer, from: ymd(s.from), to: ymd(s.to) })), warehouse: ymd(wh), flight: ymd(fl), flightNo: nf?.no || 'BDUS-' + ymd(fl).slice(2).replace(/-/g, ''), land: ymd(land), deliverFrom: ymd(day(land, 1)), deliverTo: ymd(d2), leadDays: Math.round((d2 - t0) / 864e5) };
}

// ── browse ──
// Product card: seller highlighted with its own colour, link to the seller's original product page, aligned rows
function card(p, tag) {
  const c = est(p);
  const off = p.listPriceCents && p.listPriceCents > p.priceCents ? Math.round((1 - p.priceCents / p.listPriceCents) * 100) : 0;
  const s = STORES.find((x) => x.id === p.retailer) || { c: '#1D1D1F', l: (p.store || '?')[0] };
  const sl = storeLink(p);
  return `<div class="pc" role="button" tabindex="0" data-u="${esc(p.url)}"><div class="pim">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}${off >= 5 ? `<span class="off">−${off}%</span>` : ''}${tag ? `<span class="tg2">${tag}</span>` : ''}</div>
  <div class="pb"><div class="sel" style="--sc:${s.c}"><i>${esc(s.l)}</i><b>${esc(p.store)}</b></div>
  <div class="nm">${esc(p.title)}</div>
  <div class="st">${p.stars ? `★ ${p.stars} <span>(${(p.reviews || 0).toLocaleString('en-US')})</span>` : '&nbsp;'}</div>
  <div class="bd">${tk(c.total)}</div>
  <div class="us"><span>${usd(p.priceCents)}${off >= 5 ? `<s>${usd(p.listPriceCents)}</s>` : ''}</span>${sl ? `<a class="sl2" href="${esc(sl)}" target="_blank" rel="noopener">${esc(p.store)} ↗</a>` : ''}</div></div></div>`;
}
async function doSearch() {
  const typed = $('q').value.trim(), q = typed || (cat !== 'All' ? CAT_WORD[cat] : '');
  if (typed) rememberSearch(typed);
  const sn = store !== 'all' ? (STORES.find((x) => x.id === store) || {}).n : '';
  $('rt').textContent = typed ? `Results for “${typed}”${sn ? ' at ' + sn : ''}` : (cat !== 'All' ? cat : 'Popular right now') + (sn ? ' at ' + sn : '');
  $('grid').innerHTML = '<div class="skel"></div>'.repeat(8); $('rn').textContent = 'Searching…';
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(q)}&store=${searchable(store) ? store : 'all'}${typed ? '' : '&t=0'}`);
    RESULTS = remember(d.results);
    $('rn').textContent = RESULTS.length + ' results';
    $('grid').innerHTML = RESULTS.length ? RESULTS.map((p) => card(p)).join('') : '<div class="card empty">No matches. Try another word, or paste a product link.</div>';
  } catch (e) { $('grid').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; $('rn').textContent = ''; }
}
async function doLink() {
  const url = $('lnk').value.trim(); if (!url) return;
  const btn = document.querySelector('#linkBox button'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const d = await api('/api/link', { url });
    if (d.manual) openQuote(d); else { RESULTS = [d.product, ...RESULTS]; openItem(d.product); }
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = 'Get price';
}
const SEEN = new Map();
function remember(L) { L.forEach((p) => SEEN.set(p.url, p)); return L; }
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList?.contains('pc')) e.target.click(); });
document.addEventListener('click', (e) => { if (e.target.closest('a')) return; const b = e.target.closest('.pc'); if (b && (b.closest('#grid') || b.closest('#v-store') || b.closest('#feed') || b.closest('#feed2') || b.closest('#feed3') || b.closest('#fy'))) openItem(SEEN.get(b.dataset.u) || RESULTS.find((p) => p.url === b.dataset.u)); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
$('lnk').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLink(); });
function setMode(m) {
  [...$('mode').children].forEach((x) => x.classList.toggle('on', x.dataset.m === m));
  $('searchBox').hidden = m !== 'search'; $('linkBox').hidden = m !== 'link';
  (m === 'link' ? $('lnk') : $('q')).focus({ preventScroll: true });
}
$('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
const searchable = (id) => CFG.stores.some((s) => s.id === id);
// Official store logos: put files in public/logos/<store-id>.png (e.g. amazon.png). Falls back to the letter icon.
function logoI(s) { return `<i style="background:${s.c}"><img src="/logos/${s.id}.png" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()"><span>${s.l}</span></i>`; }
function drawCats() {
  $('cats').innerHTML = ['All', ...Object.keys(CAT_WORD)].map((c) => `<button class="cat ${c === cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  const L = STORES.filter((s) => cat === 'All' || s.cats.includes(cat));
  $('tiles').innerHTML = L.map((s) => `<button class="tile ${store === s.id ? 'on' : ''}" data-st="${s.id}">${logoI(s)}${esc(s.n)}${searchable(s.id) ? '' : '<em>paste link</em>'}</button>`).join('');
}
$('cats').addEventListener('click', (e) => {
  const b = e.target.closest('.cat'); if (!b) return;
  cat = b.dataset.c; if (store !== 'all' && !(STORES.find((s) => s.id === store)?.cats.includes(cat) || cat === 'All')) store = 'all';
  drawCats(); doSearch();
});
$('tiles').addEventListener('click', (e) => {
  const b = e.target.closest('.tile'); if (!b) return;
  const s = STORES.find((x) => x.id === b.dataset.st);
  if (searchable(s.id) && THEME[s.id]) { openStore(s.id); return; }
  // stores without search: open the store, customer pastes the product link back here
  window.open(s.url, '_blank', 'noopener'); setMode('link');
  $('hint').innerHTML = `<b>${esc(s.n)}</b> opened in a new tab. Copy the product link from there and paste it above, then tap “Get price”.` + (s.id === 'costco' ? ' No Costco membership needed — WOOW buys with ours.' : '');
});

// ── store pages ──
async function fetchRow(storeId, q, rail) {
  const d = await api(`/api/search?q=${encodeURIComponent(q)}&store=${storeId}${rail ? '&t=0&rail=1' : ''}`);
  return remember(d.results || []);
}
function rowHtml(id, title, q, hero) {
  return `<div class="srow${hero ? ' sp-hero' : ''}" data-q="${esc(q)}"><div class="row-h">${hero ? `<div><h2>${esc(title)}</h2><p>Live prices from ${esc(curStore.n)}, shown delivered to Dhaka</p></div>` : `<b>${esc(title)}</b>`}<button onclick="storeSearch('${esc(q)}')">See all →</button></div><div class="rail" id="${id}">${'<div class="skel"></div>'.repeat(6)}</div></div>`;
}
let rowObs = null;
function openStore(id, push = true) {
  hideCmp();
  const s = STORES.find((x) => x.id === id), t = THEME[id]; if (!s || !t) return;
  curStore = s; store = id;
  const band = $('spBand');
  ['sb', 'sf', 'sa', 'sat'].forEach((k) => band.style.setProperty('--' + k, t[k]));
  $('spBody').style.setProperty('--sh', t.sh);
  band.classList.toggle('sp-light', !!t.light);
  $('spLogo').outerHTML = logoI(s).replace('<i ', '<i id="spLogo" '); $('spName').textContent = s.n;
  $('spQ').placeholder = `Search ${s.n}`; $('spQ').value = '';
  $('spCats').innerHTML = [['Home', ''], ...t.rows].map(([n, q], i) => `<button class="${i ? '' : 'on'}" data-q="${esc(q)}">${esc(n)}</button>`).join('');
  drawStoreHome();
  document.querySelectorAll('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-store'));
  window.scrollTo({ top: 0 });
  if (push) history.pushState({ v: 'store', s: id }, '', '#store=' + id);
}
function drawStoreHome() {
  const t = THEME[curStore.id];
  $('spBody').innerHTML = rowHtml('r0', t.hero[0], t.hero[1], true) + t.rows.map(([n, q], i) => rowHtml('r' + (i + 1), n, q)).join('');
  if (rowObs) rowObs.disconnect();
  rowObs = new IntersectionObserver((ents) => ents.forEach(async (en) => {
    if (!en.isIntersecting) return; rowObs.unobserve(en.target);
    const rail = en.target.querySelector('.rail');
    try { const L = await fetchRow(curStore.id, en.target.dataset.q, true); rail.innerHTML = L.length ? L.slice(0, 16).map((p) => card(p)).join('') : '<div class="row-empty">Nothing here right now.</div>'; }
    catch (e) { rail.innerHTML = `<div class="row-empty">${esc(e.message)}</div>`; }
  }), { rootMargin: '300px' });
  $('spBody').querySelectorAll('.srow').forEach((r) => rowObs.observe(r));
}
async function storeSearch(q) {
  q = (q ?? $('spQ').value).trim();
  if (!q) { drawStoreHome(); return; }
  rememberSearch(q);
  $('spQ').value = q;
  $('spCats').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  $('spBody').innerHTML = `<div class="rh" style="margin-top:0"><b>Results for “${esc(q)}” at ${esc(curStore.n)}</b><small id="spN">Searching…</small></div><div class="grid" id="spGrid">${'<div class="skel"></div>'.repeat(8)}</div>`;
  try {
    const L = await fetchRow(curStore.id, q);
    $('spN').textContent = L.length + ' results';
    $('spGrid').innerHTML = L.length ? L.map((p) => card(p)).join('') : `<div class="card empty">No matches at ${esc(curStore.n)}. Try another word, or paste a product link.</div>`;
  } catch (e) { $('spGrid').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
$('spQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') storeSearch(); });
$('spCats').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('spCats').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  if (!b.dataset.q) { $('spQ').value = ''; drawStoreHome(); } else storeSearch(b.dataset.q);
});

// ── price comparison (left panel) ──
let cmpMin = false; try { cmpMin = localStorage.getItem('woowCmpMin') === '1'; } catch {}
let cmpFor = null;
// phones/tablets: compare starts as a small button so it never covers the product; tap to open
const small = () => innerWidth <= 1050;
function showCmp(open, auto) {
  cmpMin = !open; if (!auto) try { localStorage.setItem('woowCmpMin', cmpMin ? '1' : '0'); } catch {}
  $('cmp').hidden = cmpMin || !$('cmpL').dataset.n; $('cmpTab').hidden = !cmpMin || !$('cmpL').dataset.n; document.body.classList.toggle('cmpon', !$('cmp').hidden);
}
$('cmpMin').onclick = () => showCmp(false);
$('cmpTab').onclick = () => showCmp(true);
function hideCmp() { document.body.classList.remove('cmpon'); $('cmp').hidden = true; $('cmpTab').hidden = true; $('cmpL').dataset.n = ''; cmpFor = null; }
async function loadCompare(p) {
  cmpFor = p.url; $('cmpL').dataset.n = '';
  if (!['amazon', 'walmart', 'target'].includes(p.retailer)) { hideCmp(); return; }
  $('cmpL').innerHTML = '<div class="cmp-load">Checking Amazon, Walmart and Target…</div>'; $('cmpL').dataset.n = '1'; showCmp(!cmpMin && !small(), true);
  let d; try { d = await api('/api/compare?url=' + encodeURIComponent(p.url)); } catch { hideCmp(); return; }
  if (cmpFor !== p.url) return;
  if (!d.offers.length) { $('cmpL').innerHTML = '<div class="cmp-load">No matching product found at other stores right now.</div>'; $('cmpN').textContent = '0'; if (small()) hideCmp(); return; }
  const all = [{ ...p, me: true }, ...d.offers].sort((a, b) => a.priceCents - b.priceCents);
  remember(d.offers);
  const top = est(all[all.length - 1]).total;
  $('cmpL').innerHTML = all.map((o, i) => {
    const s = STORES.find((x) => x.id === o.retailer) || { c: '#555', l: '?' }, c = est(o);
    return `<div class="co ${o.me ? 'me' : ''}">${i === 0 ? '<span class="best">Best price</span>' : ''}<img src="${esc(o.image || '')}" alt="">
      <div><div class="sn"><i style="background:${s.c}">${s.l}</i>${esc(o.store)}${o.me ? ' · viewing' : ''}</div><div class="t">${esc(o.title)}</div>
      <div class="p"><b>${tk(c.total)}</b><small>${usd(o.priceCents)}</small></div><div class="kgx">${c.s.c ? '+' + usd(c.s.c) + ' US delivery' : 'Free US delivery'} · ${CFG.taxRate ? 'tax ' + CFG.taxRate + '%' : 'tax-free'}</div>${i === 0 && all.length > 1 ? `<div class="save">Save ${tk(top - c.total)}</div>` : ''}</div>
      <div class="acts"><button class="a1" data-add="${esc(o.url)}">Add to cart</button>${o.me ? '' : `<button class="a2" data-view="${esc(o.url)}">View</button>`}</div>${storeLink(o) ? `<a class="sl" href="${esc(o.url)}" target="_blank" rel="noopener">${usd(o.priceCents)} on ${esc(o.store)} ↗</a>` : ''}</div>`;
  }).join('');
  $('cmpN').textContent = all.length; $('cmpL').dataset.n = String(all.length); showCmp(!cmpMin && !small(), true);
}
$('cmpL').addEventListener('click', (e) => { const a = e.target.closest('[data-add]'), v = e.target.closest('[data-view]'); if (a) cmpCart(a.dataset.add); if (v) openItem(SEEN.get(v.dataset.view)); });
function cmpCart(u) { return needLogin(() => cmpCart_(u), 'Sign in to add this to your cart.'); }
function cmpCart_(u) {
  const p = SEEN.get(u) || (cur && cur.url === u ? cur : null); if (!p) return;
  const ex = CART.find((x) => x.url === p.url && !x.option);
  if (ex) ex.qty = Math.min(9, ex.qty + 1); else CART.push({ url: p.url, qty: 1, option: '', retailer: p.retailer, store: p.store, title: p.title, image: p.image, priceCents: p.priceCents, kg: p.kg || null });
  save(); beacon('cart', p); toast('✓ Added from ' + p.store);
}

// ── price quote (Costco and other stores without instant prices) ──
function openQuote(d) {
  $('qUrl').value = d.url; $('qTitle').value = ''; $('qUsd').value = ''; $('qQty').value = 1; $('qOpt').value = '';
  $('qStore').textContent = d.store;
  $('qMember').textContent = d.retailer === 'costco' ? 'Bought with WOOW\'s Costco membership' : 'Shipped to our Delaware warehouse';
  try { const c = JSON.parse(localStorage.getItem('woowCustomer') || 'null'); if (c) { $('qName').value = c.name || ''; $('qPhone').value = c.phone || ''; $('qEmail').value = c.email || ''; $('qCity').value = c.city || 'Dhaka'; $('qAddr').value = c.address || ''; } } catch {}
  $('qErr').style.display = 'none'; go('quote');
}
async function sendQuote() { return needLogin(sendQuote_, 'Sign in to request a price from WOOW.'); }
async function sendQuote_() {
  const btn = $('qBtn'); btn.disabled = true; btn.textContent = 'Sending…'; $('qErr').style.display = 'none';
  const customer = { name: $('qName').value, phone: $('qPhone').value, email: $('qEmail').value, city: $('qCity').value, address: $('qAddr').value };
  try { localStorage.setItem('woowCustomer', JSON.stringify(customer)); } catch {}
  try {
    const d = await api('/api/quote-request', { item: { url: $('qUrl').value, title: $('qTitle').value, usd: $('qUsd').value, qty: $('qQty').value, option: $('qOpt').value } });
    location.href = `/order?id=${d.orderId}&phone=${d.phone}&quote=1`;
  } catch (e) { $('qErr').textContent = e.message; $('qErr').style.display = 'block'; btn.disabled = false; btn.textContent = 'Request price'; }
}

// ── product ──
function openItem(p) {
  if (!p) return; window._from = document.querySelector('#v-store.on') ? 'store' : 'browse'; cur = p; qty = 1; $('dQ').textContent = 1; $('dOpt').value = '';
  $('dImg').src = p.image || ''; $('dNm').textContent = p.title;
  const sl = storeLink(p); $('dSame').hidden = !sl; if (sl) { $('dSame').href = sl; $('dSame').innerHTML = `<span>✓ Same price as ${esc(p.store)}</span><b>${usd(p.priceCents)} on ${esc(p.store)} ↗</b>`; }
  $('dSrc').innerHTML = `<b>${esc(p.store)}</b>Sold and shipped in the USA`;
  $('dSt').innerHTML = p.stars ? `★ ${p.stars} <span>(${(p.reviews || 0).toLocaleString('en-US')} ratings)</span>` : '';
  upd(); go('item'); SEEN.set(p.url, p); loadCompare(p);
  rvAdd(p); rvDraw(); beacon('view', p);
}
function q(d) { qty = Math.max(1, Math.min(9, qty + d)); $('dQ').textContent = qty; upd(); }
function weightBox(c) {
  return `<div class="mini"><span>Est. weight <b>≈ ${c.kg} kg</b></span><span>Pay now <b>${tk(c.now)}</b></span><button onclick="showBrokerage()">See more</button></div>`;
}
function secondInvoice() { return ''; }
function showBrokerage() {
  $('brkList').innerHTML = (CFG.brokerageList || []).map((x) => `<li>${esc(x)}</li>`).join('');
  $('brkWa').href = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent('Hi WOOW, I want to know the customs brokerage charge for: ' + (cur ? cur.title + ' ' + cur.url : ''))}`;
  $('brkM').hidden = false;
}
function upd() {
  const c = est(cur, qty);
  $('dBd').textContent = tk(c.total); $('dUs').textContent = `${usd(cur.priceCents * qty)} at ${cur.store} · rate ৳${CFG.rate}`;
  $('dBrk').innerHTML = `<div><span>Product price<small>${usd(cur.priceCents * qty)} × ৳${CFG.rate}</small></span><b>${tk(c.item)}</b></div>
  <div><span>US delivery to WOOW warehouse<small>${shipNote(c.s)}</small></span><b class="${c.s.c ? '' : 'free'}">${c.s.c ? tk(c.usD) : 'Free'}</b></div>
  <div><span>US sales tax<small>${taxNote()} <button class="lnk" onclick="showWhy()">Why?</button></small></span><b class="${c.tax ? '' : 'free'}">${tk(c.tax)}</b></div>
  <div><span>WOOW buying service<small>${CFG.feePercent}%, minimum ৳${CFG.minFee}</small></span><b>${tk(c.fee)}</b></div>
  <div><span>Shipping &amp; customs to Dhaka<small>Est. ${c.kg} kg × ৳${CFG.kgRate.toLocaleString('en-US')}</small></span><b>${tk(c.ship)}</b></div>`;
  $('dExtra').innerHTML = weightBox(c) + secondInvoice(c);
  $('dPlan').innerHTML = planHtml(localPlan([cur.retailer]));
  setMbar(`<div><small>Delivered to Dhaka</small><b>${tk(c.total)}</b></div><button class="b1" onclick="addCart(true)">Add to cart</button><button class="b2" onclick="addCart(false);go('pay')">Buy now</button>`);
}
function addCart(show) { return needLogin(() => addCart_(show), 'Sign in to add this to your cart.'); }
function addCart_(show) {
  const option = $('dOpt').value.trim();
  const ex = CART.find((x) => x.url === cur.url && x.option === option);
  if (ex) ex.qty = Math.min(9, ex.qty + qty);
  else CART.push({ url: cur.url, qty, option, retailer: cur.retailer, store: cur.store, title: cur.title, image: cur.image, priceCents: cur.priceCents, kg: cur.kg || null });
  save(); beacon('cart', cur); if (show) toast('✓ Added to cart');
}

// ── cart + checkout (server quote) ──
async function getQuote(checkout) {
  if (!CART.length) return null;
  const d = await api('/api/quote', { ship: 1, checkout: checkout ? 1 : 0, delivery: DELIV, items: CART.map(({ url, qty, option }) => ({ url, qty, option })) });
  lastQuote = d; return d;
}
function sumHtml(d, btn) {
  const t = d.quote;
  return `<div class="tt">Order total</div>
  <div class="row" style="margin-top:8px"><span>Products (${'$' + t.usd.toFixed(2)})</span><b>${tk(t.product)}</b></div>
  <div class="row"><span>US delivery to warehouse</span><b class="${t.usShip ? '' : 'free'}">${t.usShip ? tk(t.usShip) : 'Free'}</b></div>
  <div class="row"><span>US sales tax · ${t.taxRate ? t.taxRate + '% ' + esc(t.taxState) : 'Delaware 0%'}</span><b class="${t.usTax ? '' : 'free'}">${tk(t.usTax)}</b></div>
  <div class="row"><span>WOOW buying service</span><b>${tk(t.fee)}</b></div>
  <div class="row"><span>Shipping &amp; customs · est. ${t.kg} kg <button class="lnk" onclick="showBrokerage()">See more</button></span><b>${tk(t.shipping)}</b></div>
  <div class="tot"><span>Total</span><b>${tk(t.total)}</b></div>${btn}${planHtml(d.delivery, t.pickup)}`;
}
async function rCart() {
  save();
  if (!CART.length) { setMbar(''); $('route').innerHTML = ''; $('cGroups').innerHTML = '<div class="card empty">Your cart is empty.</div><div class="rv" id="rvC"></div>'; $('cSum').innerHTML = '<button class="btn" onclick="go(\'browse\')">Start shopping</button>'; $('cGroups').insertAdjacentHTML('beforeend', removedHtml()); rvDraw(); return; }
  drawGroups(null);
  $('cSum').innerHTML = '<div class="tt">Calculating…</div>';
  try {
    const d = await getQuote();
    drawGroups(d.quote); $('route').innerHTML = routeHtml(d);
    $('cSum').innerHTML = sumHtml(d, '<button class="btn dk" style="margin-top:14px" onclick="go(\'pay\')">Checkout in Taka →</button>');
    setMbar(`<div><small>Total · ${CART.reduce((a, x) => a + x.qty, 0)} items</small><b>${tk(d.quote.total)}</b></div><button class="b2" onclick="go('pay')">Checkout →</button>`);
  } catch (e) { $('cSum').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div>`; }
}
// Cart concept: one picture of the journey — US store → WOOW warehouse (tax-free) → WOOW flight → your door
function routeHtml(d) {
  const t = d.quote, p = d.delivery;
  const step = (ic, h, v, sub) => `<div class="rs"><i>${ic}</i><b>${h}</b><em>${v}</em><small>${sub}</small></div>`;
  return `<div class="route card">${step('🛍️', 'US stores', tk(t.product), 'Same price as the store')}<span class="ra"></span>${step('🏬', 'WOOW US warehouse', t.usShip ? '+' + tk(t.usShip + t.usTax) : (t.usTax ? '+' + tk(t.usTax) : 'Free'), t.usShip ? (t.taxRate ? 'US delivery + ' + t.taxRate + '% tax' : 'US delivery · 0% tax') : (t.taxRate ? 'Free delivery + ' + t.taxRate + '% tax' : 'Free delivery · 0% tax'))}<span class="ra"></span>${step('✈️', 'WOOW flight', tk(t.shipping), p ? fd(D(p.flight)) : 'Air to Dhaka')}<span class="ra"></span>${step('🏠', 'Your door', p ? fr(D(p.deliverFrom), D(p.deliverTo)) : '', 'Customs cleared')}
  <button class="rq" onclick="showWhy()">Why this way? →</button></div>`;
}
function drawGroups(t) {
  const G = {}; CART.forEach((x, i) => (G[x.retailer || x.store] ||= []).push([x, i]));
  $('cGroups').innerHTML = Object.keys(G).map((r) => {
    const first = G[r][0][0], st = t?.stores?.find((s) => s.retailer === r);
    const sub = G[r].reduce((a, [x]) => a + x.priceCents * x.qty, 0), s = st ? { c: st.shipUsd * 100, free: !st.shipUsd, need: st.needUsd * 100, r: { freeOver: st.freeOver } } : usShip(r, sub);
    const pct = Math.min(100, Math.round(sub / (s.r.freeOver * 100) * 100));
    const sell = st?.sellerShipUsd ? `<div class="fs">+ ${usd(st.sellerShipUsd * 100)} seller's own US shipping <small>(sold by a marketplace seller)</small></div>` : '';
    const storePart = st ? st.shipUsd - (st.sellerShipUsd || 0) : null;
    const bar = (st && st.sellerShipUsd && !(storePart > 0) && !st.needUsd) ? sell
      : (s.free || (st && !st.needUsd && !(storePart > 0))) ? `<div class="fs ok">✓ Free US delivery to our warehouse</div>${sell}`
      : s.need > 0 ? `<div class="fs"><span>Add <b>${usd(s.need)}</b> from ${esc(first.store)} for free US delivery</span><i><u style="width:${pct}%"></u></i></div>${sell}`
      : `<div class="fs">US delivery to our warehouse <b>${usd(storePart * 100)}</b></div>${sell}`;
    return `<div class="card sg"><h4><span class="chip" style="position:static">${esc(first.store)}</span>${G[r].length} item${G[r].length > 1 ? 's' : ''}<small>${usd(sub)}</small></h4>${bar}` +
    G[r].map(([x, i]) => { const sl = storeLink(x); return `<div class="ci"><img src="${esc(x.image || '')}" alt=""><div><b>${esc(x.title)}</b><small>${x.option ? esc(x.option) + ' · ' : ''}Qty ${x.qty}</small>
      <div class="tr">${sl ? `<a href="${esc(sl)}" target="_blank" rel="noopener">${esc(x.store)} ${usd(x.priceCents)} ↗</a>` : `<span>${esc(x.store)} ${usd(x.priceCents)}</span>`}<span class="eq">=</span><span>WOOW ${usd(x.priceCents)}</span><span class="ok">✓ Same price</span></div>
      <button class="rm" onclick="rmv(${i})">Remove</button></div><div style="text-align:right"><b>${tk(x.priceCents / 100 * x.qty * CFG.rate)}</b></div></div>`; }).join('') + '</div>';
  }).join('') + removedHtml();
}
function showWhy() {
  const T = CFG.taxRate, W = CFG.warehouseState === 'NY' ? 'New York' : 'Delaware';
  const card = (ic, h, p) => `<div><i>${ic}</i><b>${h}</b><p>${p}</p></div>`;
  $('whyL').innerHTML = card('🏷️', 'Same price as the store', 'You pay the exact US store price. Tap the store link to check it yourself.') +
    card('🚚', 'Free US delivery over $35', 'Most stores deliver free to our US warehouse when your order from that store is $35 or more.') +
    card('🏬', T ? `${W} warehouse · ${T}% tax` : 'Delaware warehouse · 0% tax', T ? `US law adds ${T}% sales tax for deliveries in ${W}.` : 'Delaware has no sales tax. New York would add 8.875% — you save that.') +
    card('✈️', 'One box, one WOOW flight', 'US stores don\'t ship to Bangladesh. We collect every store in one box and fly it to your door.');
  $('whyWa').href = `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent('Hi WOOW, I have a question about how Buy For Me works.')}`;
  $('whyM').hidden = false;
}
// Removed items stay below the cart, so the customer can change their mind and add them back
function remLoad() { try { return JSON.parse(localStorage.getItem('woowRemoved') || '[]'); } catch { return []; } }
function remSave(L) { try { localStorage.setItem('woowRemoved', JSON.stringify(L.slice(0, 10))); } catch {} }
function rmv(i) { const [x] = CART.splice(i, 1); if (x) remSave([x, ...remLoad().filter((r) => !(r.url === x.url && r.option === x.option))]); rCart(); toast('Removed · add back below'); }
function addBack(k) {
  const L = remLoad(), x = L[k]; if (!x) return;
  const ex = CART.find((c) => c.url === x.url && c.option === x.option);
  if (ex) ex.qty = Math.min(9, ex.qty + x.qty); else CART.push(x);
  L.splice(k, 1); remSave(L); beacon('cart', x); rCart(); toast('✓ Added back to cart');
}
function remClear() { remSave([]); rCart(); }
function removedHtml() {
  const L = remLoad(); if (!L.length) return '';
  return `<div class="card sg rmd"><h4>Removed from cart<button class="lnk" onclick="remClear()">Clear</button></h4>` + L.map((x, k) => `<div class="ci"><img src="${esc(x.image || '')}" alt=""><div><b>${esc(x.title)}</b><small>${esc(x.store)} · ${x.option ? esc(x.option) + ' · ' : ''}Qty ${x.qty} · ${usd(x.priceCents)}</small></div><button class="ab" onclick="addBack(${k})">+ Add back</button></div>`).join('') + '</div>';
}
// ── delivery: saved address (default first), new address (location / Google verified or typed), or free pickup ──
let DELIV = 'home', ADDR = null, ADDING = false, NEWLOC = null;
function drawDelivery() {
  [...$('dlv').children].forEach((b) => b.classList.toggle('on', b.dataset.d === DELIV));
  $('dHomeFee').textContent = CFG.homeDeliveryFee ? tk(CFG.homeDeliveryFee) : 'Free';
  $('addrBox').hidden = DELIV !== 'home'; $('pickBox').hidden = DELIV !== 'pickup';
  const P = CFG.pickup;
  $('pickBox').innerHTML = `<div class="pk"><b>🏢 ${esc(P.name)}</b><span>📍 ${esc(P.address)}</span><span>☎️ <a href="tel:${P.hotline.replace(/[^+\d]/g, '')}">${esc(P.hotline)}</a></span><span>🕙 ${esc(P.hours)} · ${esc(P.closed)}</span><a class="lnk2" href="${P.map}" target="_blank" rel="noopener">Open in Google Maps ↗</a><em>We'll message you when your parcel is ready to collect. Bring your order number.</em></div>`;
  const L = ME?.addresses || [];
  if (!ADDR || !L.some((a) => a.id === ADDR)) ADDR = (L.find((a) => a.isDefault) || L[0] || {}).id || null;
  $('addrBox').innerHTML = (L.length ? `<div class="adl">${L.map((a) => `<button class="adr ${a.id === ADDR ? 'on' : ''}" data-ad="${a.id}"><span class="ck"></span><b>${esc(a.label)}${a.isDefault ? ' <em>Default</em>' : ''}${a.verified ? ` <i title="Location verified">📍 ${a.verified === 'google' ? 'Google verified' : 'Verified'}</i>` : ''}</b><span>${esc(a.name)} · ${esc(a.phone)}</span><span>${esc([a.line, a.area, a.city].filter(Boolean).join(', '))}</span><u data-del="${a.id}">Remove</u></button>`).join('')}</div>` : '') +
    (ADDING || !L.length ? addrForm() : `<button class="hb2" onclick="ADDING=true;NEWLOC=null;drawDelivery()">+ Add a new address</button>`);
  if (ADDING || !L.length) setupPlaces();
}
function addrForm() {
  return `<div class="af"><div class="afh"><b>New delivery address</b>${(ME?.addresses || []).length ? '<button class="lnk" onclick="ADDING=false;drawDelivery()">Cancel</button>' : ''}</div>
  <div class="chips" id="afLabel">${['Home', 'Office', 'Other'].map((x, i) => `<button class="${i ? '' : 'on'}" data-l="${x}">${x}</button>`).join('')}</div>
  <div class="fg">
    <label>Receiver name<input class="inp" id="afName" value="${esc(ME?.name || '')}"></label>
    <label>Mobile<input class="inp" id="afPhone" inputmode="tel" value="${esc(ME?.phone || '')}"></label>
    <label class="full">Full address<input class="inp" id="afLine" placeholder="House, road, block — start typing${CFG.mapsKey ? ' to search Google Maps' : ''}" autocomplete="street-address"></label>
    <label>Area / thana<input class="inp" id="afArea" placeholder="e.g. Mirpur 10"></label>
    <label>City / district<input class="inp" id="afCity" value="Dhaka"></label>
  </div>
  <div class="afl"><button class="hb2" onclick="useLocation()">📍 Use my current location</button><span id="afLoc">${NEWLOC ? locText(NEWLOC) : 'Optional — helps our rider find you'}</span></div>
  <label class="dfl"><input type="checkbox" id="afDef" ${(ME?.addresses || []).length ? '' : 'checked'}> Make this my default address</label>
  <div class="err" id="afErr"></div>
  <button class="btn dk" style="margin-top:10px" onclick="saveAddr()">Save address</button></div>`;
}
const locText = (l) => `<b class="okv">✓ ${l.verified === 'google' ? 'Verified on Google Maps' : 'Location verified'}</b> · <a href="https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}" target="_blank" rel="noopener">check on map ↗</a>`;
function useLocation() {
  if (!navigator.geolocation) return toast('Location is not available on this device');
  $('afLoc').textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(async (pos) => {
    NEWLOC = { lat: pos.coords.latitude, lng: pos.coords.longitude, verified: 'map' };
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${NEWLOC.lat}&lon=${NEWLOC.lng}`, { headers: { 'Accept-Language': 'en' } });
      const g = (await r.json()).address || {};
      if (!$('afArea').value) $('afArea').value = g.suburb || g.neighbourhood || g.quarter || g.city_district || '';
      if (g.city || g.state_district) $('afCity').value = (g.city || g.state_district || '').replace(/ District$/, '');
      if (!$('afLine').value && g.road) $('afLine').value = [g.house_number, g.road].filter(Boolean).join(', ');
    } catch {}
    $('afLoc').innerHTML = locText(NEWLOC);
  }, () => { $('afLoc').textContent = 'Could not get your location — please type the address.'; }, { enableHighAccuracy: true, timeout: 12000 });
}
// Google Places autocomplete (only when a Google Maps key is set in Cloudflare: GOOGLE_MAPS_KEY)
let gLoaded = false;
function setupPlaces() {
  if (!CFG.mapsKey) return;
  const attach = () => {
    const el = $('afLine'); if (!el || el.dataset.g || !window.google?.maps?.places) return; el.dataset.g = 1;
    const ac = new google.maps.places.Autocomplete(el, { componentRestrictions: { country: 'bd' }, fields: ['formatted_address', 'geometry', 'address_components'] });
    ac.addListener('place_changed', () => {
      const pl = ac.getPlace(); if (!pl.geometry) return;
      const comp = (t) => (pl.address_components || []).find((c) => c.types.includes(t))?.long_name || '';
      NEWLOC = { lat: pl.geometry.location.lat(), lng: pl.geometry.location.lng(), verified: 'google' };
      $('afArea').value = comp('sublocality_level_1') || comp('sublocality') || comp('neighborhood') || $('afArea').value;
      $('afCity').value = comp('locality') || comp('administrative_area_level_2') || $('afCity').value;
      $('afLoc').innerHTML = locText(NEWLOC);
    });
  };
  if (gLoaded) return attach();
  gLoaded = true; window._gInit = attach;
  const sc = document.createElement('script'); sc.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.mapsKey)}&libraries=places&callback=_gInit`; sc.async = true; document.head.appendChild(sc);
}
async function saveAddr() {
  $('afErr').style.display = 'none';
  try {
    const d = await api('/api/me/address', { label: $('afLabel').querySelector('.on')?.dataset.l || 'Home', name: $('afName').value, phone: $('afPhone').value, line: $('afLine').value, area: $('afArea').value, city: $('afCity').value, lat: NEWLOC?.lat ?? '', lng: NEWLOC?.lng ?? '', verified: NEWLOC?.verified || '', isDefault: $('afDef').checked });
    ME.addresses = d.addresses; ADDR = d.addresses[d.addresses.length - 1].id; ADDING = false; NEWLOC = null; drawDelivery(); toast('✓ Address saved');
  } catch (e) { $('afErr').textContent = e.message; $('afErr').style.display = 'block'; }
}
document.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); if (!confirm('Remove this address?')) return; const d = await api('/api/me/address', { delete: del.dataset.del }); ME.addresses = d.addresses; drawDelivery(); return; }
  const a = e.target.closest('[data-ad]'); if (a) { ADDR = a.dataset.ad; drawDelivery(); }
  const l = e.target.closest('#afLabel button'); if (l) $('afLabel').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === l));
});
$('dlv').addEventListener('click', (e) => { const b = e.target.closest('.op'); if (!b) return; DELIV = b.dataset.d; drawDelivery(); rPay(); });

async function rPay() {
  if (!CART.length) return go('browse');
  drawDelivery();
  $('pSum').innerHTML = '<div class="tt">Calculating…</div>';
  let d; try { d = await getQuote(true); } catch (e) { $('pSum').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div>`; return; }
  drawPay(d);
}
function drawPay(d) {
  const t = d.quote, now = plan === 'full' ? t.total : t.payNowSplit;
  $('pFull').textContent = tk(t.total); $('pSplit').textContent = tk(t.payNowSplit) + ' now';
  const ml = { bkash: 'bKash', nagad: 'Nagad', card: 'card', bank: 'bank transfer' }[method];
  setMbar(`<div><small>Pay now · ${ml}</small><b>${tk(now)}</b></div><button class="b2" onclick="placeOrder()">Pay ${tk(now)}</button>`);
  $('pSum').innerHTML = sumHtml(d, `<div class="now"><span>Pay now</span><b>${tk(now)}</b></div>${plan === 'split' ? `<div class="row"><span>On arrival in Dhaka</span><b>${tk(t.shipping)}</b></div>` : ''}
   <button class="btn dk" id="payBtn" style="margin-top:12px" onclick="placeOrder()">Pay ${tk(now)} with ${ml}</button><div class="err" id="pErr"></div>
   <p class="note">✓ Same price as the store website. We re-check it when you press Pay. Rate $1 = ৳${t.rate}. By paying you agree WOOW buys these items for you from US stores. Final shipping is based on actual weight.</p>`);
}
$('plan').addEventListener('click', (e) => { const b = e.target.closest('.op'); if (!b) return; $('plan').querySelectorAll('.op').forEach((x) => x.classList.toggle('on', x === b)); plan = b.dataset.v; if (lastQuote) drawPay(lastQuote); });
$('pm').addEventListener('click', (e) => { const b = e.target.closest('.op'); if (!b) return; $('pm').querySelectorAll('.op').forEach((x) => x.classList.toggle('on', x === b)); method = b.dataset.m; if (lastQuote) drawPay(lastQuote); });
async function placeOrder() {
  if (DELIV === 'home' && !ADDR) { $('pErr').textContent = 'Please add your delivery address, or choose free pickup from the WOOW office.'; $('pErr').style.display = 'block'; $('addrBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  const btn = $('payBtn'); $('pErr').style.display = 'none'; btn.disabled = true; btn.textContent = 'Checking today\'s store price…';
  const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sid': SID }, body: JSON.stringify({ delivery: DELIV, addressId: ADDR, plan, method, expectedTotal: lastQuote?.quote?.total, items: CART.map(({ url, qty, option }) => ({ url, qty, option })) }) });
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
  const phone = encodeURIComponent((DELIV === 'home' ? (ME.addresses.find((a) => a.id === ADDR) || ME).phone : ME.phone).replace(/\D/g, '').replace(/^880/, '0'));
  if (d.next.type === 'redirect') location.href = d.next.url;
  else location.href = `/order?id=${d.orderId}&phone=${phone}&bank=1`;
}

// ── phone bottom bar: price + main button always in reach (product, cart, checkout) ──
function setMbar(html) { const m = $('mbar'); m.innerHTML = html || ''; m.hidden = !html; document.body.classList.toggle('has-mbar', !!html); }

// ── navigation ──
function go(v) {
  if ((v === 'cart' || v === 'pay') && !ME) return needLogin(() => go(v), v === 'pay' ? 'Sign in to check out and pay in Taka.' : 'Sign in to see your cart.');
  if (v !== 'item') hideCmp();
  if (!['item', 'cart', 'pay'].includes(v)) setMbar('');
  document.querySelectorAll('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  if (v === 'cart') rCart(); if (v === 'pay') rPay(); if (v === 'browse') { rvDraw(); loadForYou(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (history.state?.v !== v) history.pushState({ v }, '', v === 'browse' ? '/' : '#' + v);
}
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h.startsWith('store=')) openStore(h.slice(6), false); });
window.addEventListener('popstate', (e) => { if (e.state?.v === 'store') openStore(e.state.s, false); else go(e.state?.v || 'browse'); });

(async function init() {
  CFG = await api('/api/config');
  $('rateTx').textContent = `$1 = ৳${CFG.rate}`; drawCats();
  if (CFG.demo.catalog || CFG.demo.payments) { $('demoBar').hidden = false; $('demoBar').textContent = 'Preview · ' + [CFG.demo.catalog && 'sample products', CFG.demo.payments && 'test payments'].filter(Boolean).join(' · '); }
  ME = CFG.me; drawMe();
  save(); rvDraw(); loadFeed(); loadForYou(); doSearch(); beacon('visit');
  const h = location.hash.slice(1); if (h === 'cart' || h === 'pay') go(h); else if (h.startsWith('store=')) openStore(h.slice(6), false);
})();
