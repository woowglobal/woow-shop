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
  flightDays: [3, 6],   // WOOW flights: 0=Sun … 3=Wed, 6=Sat
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
  if (Array.isArray(p.brokerageList)) next.brokerageList = p.brokerageList.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 40);
  if (Array.isArray(p.flightDays)) next.flightDays = p.flightDays.map(Number).filter((d) => d >= 0 && d <= 6);
  await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('pricing', JSON.stringify(next)).run();
  return next;
}

/** items: [{ retailer, priceCents, qty, kg }] */
export function quote(items, p) {
  let usd = 0, kg = 0;
  const lines = items.map((it) => {
    const lineUsd = (it.priceCents / 100) * it.qty;
    usd += lineUsd;
    kg += (it.kg || p.defaultKg) * it.qty;
    return { ...it, lineUsd: Math.round(lineUsd * 100) / 100, lineBdt: Math.round(lineUsd * p.rate) };
  });
  const sellerKg = Math.round(kg * 100) / 100;
  kg = Math.ceil(kg * (1 + (p.packagingPercent ?? 10) / 100) * 10) / 10; // + packing box weight
  const product = Math.round(usd * p.rate);
  const fee = items.length ? Math.round(Math.max(p.minFee, product * p.feePercent / 100)) : 0;
  const shipping = Math.round(kg * p.kgRate);
  return { lines, usd: Math.round(usd * 100) / 100, rate: p.rate, product, usTax: 0, fee, sellerKg, packagingPercent: p.packagingPercent ?? 10, kg, shipping, total: product + fee + shipping, payNowSplit: product + fee };
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
  let flight = day(warehouse, 1);
  for (let i = 0; i < 14 && !p.flightDays.includes(flight.getUTCDay()); i++) flight = day(flight, 1);
  const land = day(flight, p.dhakaDaysAfterFlight);
  const d2 = day(land, 2);
  return {
    buy: ymd(buy),
    stores: stores.map((s) => ({ retailer: s.retailer, from: ymd(s.from), to: ymd(s.to) })),
    warehouse: ymd(warehouse), flight: ymd(flight), flightNo: 'BDUS-' + ymd(flight).slice(2).replace(/-/g, ''),
    land: ymd(land), deliverFrom: ymd(day(land, 1)), deliverTo: ymd(d2),
    leadDays: Math.round((d2 - t0) / DAY),
  };
}
