// Money rules + delivery plan. Prices are ALWAYS calculated on the server.
export const DEFAULT_SETTINGS = {
  rate: 122.4,          // 1 USD = ? BDT  (update daily in Admin → Settings)
  feePercent: 8,        // WOOW buying service, % of product price
  minFee: 250,          // minimum service fee in BDT
  kgRate: 1650,         // shipping + customs to Dhaka, BDT per kg
  defaultKg: 0.5,       // estimated weight when the store gives none
  packagingPercent: 10, // seller's courier box adds weight: estimate = seller weight + 10%
  brokerageList: [      // products that may have a customs brokerage charge in Dhaka (edit in Admin → Settings)
    'Mobile phones and tablets', 'Laptops and computers', 'Smart watches and wearables', 'Cameras, drones and lenses',
    'Perfume and cosmetics in large quantity', 'Vitamins, supplements and medicines', 'Baby formula and food',
    'Branded watches, jewellery and gold', 'Power banks and items with large batteries', 'Car and motorcycle parts',
    'Commercial quantity of any item (more than personal use)'],
  rateLockMinutes: 15,
  // US delivery: store → WOOW US warehouse. Free when that store's subtotal reaches freeOver (USD), else fee (USD).
  // Zinc's live offer data (shipping_options) is used at checkout when available; these rules are the fallback.
  usShipping: {
    amazon: { freeOver: 35, fee: 6.99 }, walmart: { freeOver: 35, fee: 6.99 }, target: { freeOver: 35, fee: 5.99 },
    bestbuy: { freeOver: 35, fee: 5.99 }, macys: { freeOver: 25, fee: 10.95 }, costco: { freeOver: 75, fee: 9.99 },
    default: { freeOver: 35, fee: 7.99 },
  },
  warehouseState: 'DE',  // DE = Delaware (no sales tax) · NY = New York
  taxRates: { DE: 0, NY: 8.875 }, // % sales tax on products + US delivery
  zincDailyBudgetCents: 300,
  homeDeliveryFee: 0,    // ৳ for home delivery in Bangladesh (pickup from the WOOW office is always free)
  guard: { browsePer30: 50, paidPer30: 50, guestPaidPer30: 15, ipPaidPer30: 100, blockHours: 6 }, // stop paid Zinc searches after this much per day (saved products are used instead)
  liveFreshMinutes: 15,  // at Pay, skip the paid live price check if we checked this product in the last N minutes
  flightMonthDays: [10, 20, 30], // WOOW flights each month (30 → last day in short months)
  flights: [],          // exact upcoming flights, override the monthly days: [{ date:'2026-10-20', no:'BDUS-261020', note, cancelled }]
  dhakaDaysAfterFlight: 3,
  transitDays: {        // store → US warehouse, [min, max] days
    amazon: [2, 3], walmart: [3, 5], target: [3, 5], bestbuy: [3, 5], costco: [4, 7],
    macys: [4, 7], ebay: [4, 7], default: [4, 7],
  },
};

export async function getPricing(db) {
  const r = await db.prepare('SELECT value FROM settings WHERE key=?').bind('pricing').first();
  return { ...DEFAULT_SETTINGS, ...(r ? JSON.parse(r.value) : {}) };
}

export async function savePricing(db, p) {
  const next = await getPricing(db);
  for (const k of ['rate', 'feePercent', 'minFee', 'kgRate', 'defaultKg', 'packagingPercent', 'rateLockMinutes', 'dhakaDaysAfterFlight']) {
    if (p[k] !== undefined && p[k] !== '' && !Number.isNaN(Number(p[k]))) next[k] = Number(p[k]);
  }
  if (p.guard && typeof p.guard === 'object') { next.guard = { ...(next.guard || {}) }; for (const [k, v] of Object.entries(p.guard)) if (['browsePer30', 'paidPer30', 'guestPaidPer30', 'ipPaidPer30', 'blockHours'].includes(k) && Number(v) > 0) next.guard[k] = Math.min(10000, Number(v)); }
  for (const k of ['zincDailyBudgetCents', 'liveFreshMinutes', 'homeDeliveryFee']) if (p[k] !== undefined && p[k] !== '' && !Number.isNaN(Number(p[k]))) next[k] = Math.max(0, Number(p[k]));
  if (p.warehouseState && /^[A-Z]{2}$/.test(p.warehouseState)) next.warehouseState = p.warehouseState;
  if (p.taxRates && typeof p.taxRates === 'object') next.taxRates = Object.fromEntries(Object.entries(p.taxRates).filter(([k, v]) => /^[A-Z]{2}$/.test(k) && v !== '' && Number(v) >= 0 && Number(v) < 20).map(([k, v]) => [k, Number(v)]));
  if (p.usShipping && typeof p.usShipping === 'object') {
    const u = {};
    for (const [k, v] of Object.entries(p.usShipping)) if (/^[a-z]+$/.test(k) && v && Number(v.freeOver) >= 0 && Number(v.fee) >= 0) u[k] = { freeOver: Number(v.freeOver), fee: Number(v.fee) };
    if (u.default) next.usShipping = u;
  }
  if (Array.isArray(p.brokerageList)) next.brokerageList = p.brokerageList.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 40);
  if (Array.isArray(p.flightMonthDays)) { const d = p.flightMonthDays.map(Number).filter((x) => x >= 1 && x <= 31); if (d.length) next.flightMonthDays = [...new Set(d)].sort((a, b) => a - b); }
  if (Array.isArray(p.flights)) next.flights = cleanFlights(p.flights);
  await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('pricing', JSON.stringify(next)).run();
  return next;
}

export const taxRate = (p) => Number((p.taxRates || {})[p.warehouseState] || 0);
export const shipRule = (p, retailer) => (p.usShipping || {})[retailer] || (p.usShipping || {}).default || { freeOver: 35, fee: 7.99 };

/** items: [{ retailer, priceCents, qty, kg, shipCents? }]
 *  Per store: US delivery to the WOOW warehouse (free over the store's limit), then US sales tax
 *  for the warehouse state (Delaware 0%), WOOW fee, and air shipping to Dhaka by estimated weight. */
export function quote(items, p, opt = {}) {
  let usd = 0, kg = 0;
  const groups = {};
  const lines = items.map((it) => {
    const lineUsd = (it.priceCents / 100) * it.qty;
    usd += lineUsd;
    kg += (it.kg || p.defaultKg) * it.qty;
    const g = (groups[it.retailer] ||= { retailer: it.retailer, store: it.store, subCents: 0, firstCents: 0, zincShip: [], sellerCents: 0, noFree: false });
    g.subCents += it.priceCents * it.qty;
    if (it.thirdParty) {
      // marketplace seller: always pays the seller's own shipping (per unit, safe side), never the store's free-over-$35
      g.sellerCents += (Number.isFinite(it.shipCents) ? it.shipCents : Math.round(shipRule(p, it.retailer).fee * 100)) * it.qty;
    } else {
      g.firstCents += it.priceCents * it.qty;
      if (Number.isFinite(it.shipCents)) g.zincShip.push(it.shipCents);
      if (it.freeShipping === false && !Number.isFinite(it.shipCents)) g.noFree = true; // store says: not free-shipping eligible
    }
    return { ...it, lineUsd: Math.round(lineUsd * 100) / 100, lineBdt: Math.round(lineUsd * p.rate) };
  });
  const stores = Object.values(groups).map((g) => {
    const r = shipRule(p, g.retailer), limit = Math.round(r.freeOver * 100);
    let storeShip = 0, source = 'none';
    if (g.firstCents) {
      if (limit && g.firstCents >= limit && !g.noFree) { storeShip = 0; source = 'free_over'; }
      else if (g.zincShip.length) { storeShip = Math.max(...g.zincShip); source = 'zinc'; }
      else { storeShip = Math.round(r.fee * 100); source = 'rule'; }
    }
    const shipCents = storeShip + g.sellerCents;
    if (g.sellerCents) source = source === 'none' ? 'seller' : source + '+seller';
    return { retailer: g.retailer, store: g.store, subUsd: g.subCents / 100, shipUsd: shipCents / 100, sellerShipUsd: g.sellerCents / 100, freeOver: r.freeOver,
      needUsd: storeShip && !g.noFree ? Math.max(0, Math.round(limit - g.firstCents) / 100) : 0, source };
  });
  const usShipUsd = Math.round(stores.reduce((a, s) => a + s.shipUsd, 0) * 100) / 100;
  const tr = taxRate(p), taxUsd = Math.round((usd + usShipUsd) * tr) / 100;
  const sellerKg = Math.round(kg * 100) / 100;
  kg = Math.ceil(kg * (1 + (p.packagingPercent ?? 10) / 100) * 10) / 10; // + packing box weight
  const product = Math.round(usd * p.rate);
  const usShip = Math.round(usShipUsd * p.rate), usTax = Math.round(taxUsd * p.rate);
  const fee = items.length ? Math.round(Math.max(p.minFee, product * p.feePercent / 100)) : 0;
  const shipping = Math.round(kg * p.kgRate);
  const payNowSplit = product + usShip + usTax + fee;
  const localDelivery = opt.pickup ? 0 : Math.round(p.homeDeliveryFee || 0); // paid with the second (arrival) invoice
  return {
    pickup: !!opt.pickup, localDelivery,
    lines, usd: Math.round(usd * 100) / 100, rate: p.rate, product, stores, usShipUsd, usShip,
    taxState: p.warehouseState, taxRate: tr, taxUsd, usTax, fee, sellerKg, packagingPercent: p.packagingPercent ?? 10, kg, shipping,
    total: payNowSplit + shipping + localDelivery, payNowSplit,
  };
}

export function cleanFlights(list) {
  const today = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const m = new Map();
  for (const f of list) {
    const date = String(f?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) continue;
    m.set(date, { date, no: String(f.no || f.flightNo || '').slice(0, 30), note: String(f.note || '').slice(0, 120), cancelled: !!f.cancelled });
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 60);
}
/** Upcoming WOOW flights from `from`: monthly days (10/20/30; 30 → last day in short months)
 *  merged with the exact list (admin or WOOW main system). A cancelled entry removes that date. */
export function upcomingFlights(from, p, n = 8) {
  const ymd = (d) => d.toISOString().slice(0, 10), f0 = ymd(from);
  const exact = (p.flights || []).filter((f) => f.date >= f0);
  const cancelled = new Set(exact.filter((f) => f.cancelled).map((f) => f.date));
  const out = new Map(exact.filter((f) => !f.cancelled).map((f) => [f.date, { date: f.date, no: f.no || '', note: f.note || '', source: 'set' }]));
  const days = p.flightMonthDays?.length ? p.flightMonthDays : [10, 20, 30];
  for (let mo = 0; mo < 6; mo++) {
    const y = from.getUTCFullYear(), m = from.getUTCMonth() + mo, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (const d of days) {
      const k = ymd(new Date(Date.UTC(y, m, Math.min(d, last), 12)));
      if (k >= f0 && !cancelled.has(k) && !out.has(k)) out.set(k, { date: k, no: '', note: '', source: 'monthly' });
    }
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, n)
    .map((f) => ({ ...f, no: f.no || 'BDUS-' + f.date.slice(2).replace(/-/g, '') }));
}
export function nextFlight(from, p) {
  const f = upcomingFlights(from, p, 1)[0];
  return f ? { date: new Date(f.date + 'T12:00:00Z'), no: f.no, note: f.note } : { date: new Date(from.getTime() + 10 * 864e5), no: '', note: '' };
}

/** Delivery plan in Dhaka dates: warehouse date, next WOOW flight, Dhaka arrival, delivery window. */
export function deliveryPlan(retailers, p, now = Date.now()) {
  const DAY = 864e5;
  const t0 = new Date(now + 6 * 3600e3); t0.setUTCHours(12, 0, 0, 0); // Dhaka "today" at noon
  const day = (d, n) => new Date(d.getTime() + n * DAY);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const buy = day(t0, 1);
  const stores = [...new Set(retailers)].map((r) => {
    const [a, b] = p.transitDays[r] || p.transitDays.default;
    return { retailer: r, from: day(buy, a), to: day(buy, b) };
  });
  const warehouse = stores.reduce((m, s) => (s.to > m ? s.to : m), buy);
  const nf = nextFlight(day(warehouse, 1), p), flight = nf.date;
  const land = day(flight, p.dhakaDaysAfterFlight);
  const d2 = day(land, 2);
  return {
    buy: ymd(buy),
    stores: stores.map((s) => ({ retailer: s.retailer, from: ymd(s.from), to: ymd(s.to) })),
    warehouse: ymd(warehouse), flight: ymd(flight), flightNo: nf.no || 'BDUS-' + ymd(flight).slice(2).replace(/-/g, ''), flightNote: nf.note || '',
    land: ymd(land), deliverFrom: ymd(day(land, 1)), deliverTo: ymd(d2),
    leadDays: Math.round((d2 - t0) / DAY),
  };
}

/** Orders not yet flown follow schedule changes: keep buy/warehouse dates, move flight → Dhaka → delivery. */
export function refreshPlan(plan, p) {
  if (!plan?.warehouse) return plan;
  const DAY = 864e5, ymd = (d) => d.toISOString().slice(0, 10);
  const wh = new Date(plan.warehouse + 'T12:00:00Z'), nf = nextFlight(new Date(wh.getTime() + DAY), p);
  if (ymd(nf.date) === plan.flight) return plan;
  const land = new Date(nf.date.getTime() + p.dhakaDaysAfterFlight * DAY);
  return { ...plan, flight: ymd(nf.date), flightNo: nf.no || 'BDUS-' + ymd(nf.date).slice(2).replace(/-/g, ''), flightNote: nf.note || '', land: ymd(land), deliverFrom: ymd(new Date(land.getTime() + DAY)), deliverTo: ymd(new Date(land.getTime() + 2 * DAY)), moved: true };
}
