// Customer accounts: sign up / sign in with mobile + password, sessions in an HttpOnly cookie,
// saved delivery addresses. Passwords are stored only as salted PBKDF2 hashes.
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const COOKIE = 'wsid';
const DAYS = 30;

async function pbkdf2(password, saltHex, iter = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPassword(pw) { const salt = rand(16); return `pbkdf2$100000$${salt}$${await pbkdf2(pw, salt)}`; }
async function checkPassword(pw, stored) {
  const [, iter, salt, h] = String(stored || '').split('$');
  if (!salt || !h) return false;
  const x = enc.encode(await pbkdf2(pw, salt, Number(iter))), y = enc.encode(h);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export function bdPhone(p) {
  let s = String(p || '').replace(/[^\d+]/g, '');
  if (s.startsWith('+880')) s = '0' + s.slice(4); else if (s.startsWith('880')) s = '0' + s.slice(3);
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}
const ipOf = (req) => req.headers.get('cf-connecting-ip') || '';

// failed sign-in attempts: 8 per mobile / 20 per IP in 15 minutes → wait
export async function tooManyFails(env, keys, max = 8) {
  const since = Date.now() - 15 * 60000;
  for (const [k, m] of keys) {
    const r = await env.DB.prepare('SELECT COUNT(*) n FROM auth_fail WHERE k=? AND ts>?').bind(k, since).first().catch(() => ({ n: 0 }));
    if (r.n >= (m || max)) return true;
  }
  return false;
}
export const addFail = (env, k) => env.DB.prepare('INSERT INTO auth_fail (k,ts) VALUES (?,?)').bind(k, Date.now()).run().catch(() => {});

function cookieOf(req) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})'));
  return m ? m[1] : null;
}
export function setCookie(token, secure = true) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;

export async function currentUser(env, req) {
  const t = cookieOf(req); if (!t) return null;
  const s = await env.DB.prepare('SELECT user_id, expires, admin FROM sessions WHERE token=?').bind(await sha(t)).first().catch(() => null);
  if (!s || s.expires < Date.now()) return null;
  const u = await env.DB.prepare('SELECT id, phone, name, email, addresses, disabled, google_sub, apple_sub, phone_verified, pass FROM users WHERE id=?').bind(s.user_id).first();
  if (!u || (u.disabled && !s.admin)) return null;
  return { ...u, addresses: u.addresses ? JSON.parse(u.addresses) : [], asAdmin: !!s.admin };
}
export async function newSession(env, req, userId, { admin = false } = {}) {
  const token = rand(32);
  await env.DB.prepare('INSERT INTO sessions (token,user_id,created,expires,ip,admin) VALUES (?,?,?,?,?,?)').bind(await sha(token), userId, Date.now(), Date.now() + (admin ? 2 * 3600e3 : DAYS * 864e5), ipOf(req), admin ? 1 : 0).run();
  if (!admin) await env.DB.prepare('UPDATE users SET last_login=? WHERE id=?').bind(new Date().toISOString(), userId).run();
  return token;
}
export const publicUser = (u) => u && {
  name: u.name, phone: u.phone, email: u.email || '', addresses: u.addresses || [], asAdmin: !!u.asAdmin,
  linked: { google: !!u.google_sub, apple: !!u.apple_sub, whatsapp: !!u.phone_verified, password: !!u.pass },
};

export async function signup(env, req, b) {
  const name = String(b.name || '').trim().slice(0, 80), phone = bdPhone(b.phone), email = String(b.email || '').trim().slice(0, 120), pw = String(b.password || '');
  if (name.length < 2) throw new Error('Please enter your name.');
  if (!phone) throw new Error('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please check your email address.');
  if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
  if (await tooManyFails(env, [['su:' + ipOf(req), 10]])) throw new Error('Too many attempts. Please try again in 15 minutes.');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE phone=?').bind(phone).first();
  if (exists) { await addFail(env, 'su:' + ipOf(req)); throw new Error('This mobile number already has an account. Please sign in.'); }
  const id = 'U' + rand(6);
  await env.DB.prepare('INSERT INTO users (id,phone,name,email,pass,addresses,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, phone, name, email || null, await hashPassword(pw), '[]', new Date().toISOString()).run();
  return { token: await newSession(env, req, id), user: { name, phone, email, addresses: [] } };
}

export async function login(env, req, b) {
  const phone = bdPhone(b.phone), pw = String(b.password || '');
  if (!phone || !pw) throw new Error('Enter your mobile number and password.');
  if (await tooManyFails(env, [['ph:' + phone, 8], ['ip:' + ipOf(req), 20]])) throw new Error('Too many wrong tries. Please wait 15 minutes or call WOOW: +88 09649-223322.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE phone=?').bind(phone).first();
  if (!u || u.disabled || !u.pass || !(await checkPassword(pw, u.pass))) { await addFail(env, 'ph:' + phone); await addFail(env, 'ip:' + ipOf(req)); throw new Error('Mobile number or password is not correct.'); }
  return { token: await newSession(env, req, u.id), user: publicUser({ ...u, addresses: u.addresses ? JSON.parse(u.addresses) : [] }) };
}

export async function logout(env, req) {
  const t = cookieOf(req); if (t) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(await sha(t)).run();
}

// Saved addresses: [{ id, label, name, phone, line, area, city, lat, lng, verified, isDefault }]
export async function saveAddress(env, user, a) {
  const list = [...(user.addresses || [])];
  const clean = {
    id: String(a.id || 'A' + rand(4)).slice(0, 12), label: String(a.label || 'Home').slice(0, 20), name: String(a.name || user.name).trim().slice(0, 80),
    phone: bdPhone(a.phone) || user.phone, line: String(a.line || '').trim().slice(0, 200), area: String(a.area || '').trim().slice(0, 80), city: String(a.city || 'Dhaka').trim().slice(0, 60),
    lat: Number.isFinite(+a.lat) && a.lat !== '' && a.lat !== null ? +(+a.lat).toFixed(6) : null, lng: Number.isFinite(+a.lng) && a.lng !== '' && a.lng !== null ? +(+a.lng).toFixed(6) : null,
    verified: a.verified === 'google' ? 'google' : a.verified ? 'map' : '', isDefault: !!a.isDefault,
  };
  if (clean.line.length < 5) throw new Error('Please enter the full address (house, road, area).');
  const i = list.findIndex((x) => x.id === clean.id);
  if (i >= 0) list[i] = clean; else list.push(clean);
  if (clean.isDefault || list.length === 1) list.forEach((x) => { x.isDefault = x.id === clean.id; });
  if (list.length > 10) throw new Error('You can save up to 10 addresses.');
  await env.DB.prepare('UPDATE users SET addresses=? WHERE id=?').bind(JSON.stringify(list), user.id).run();
  return list;
}
export async function deleteAddress(env, user, id) {
  let list = (user.addresses || []).filter((x) => x.id !== id);
  if (list.length && !list.some((x) => x.isDefault)) list[0].isDefault = true;
  await env.DB.prepare('UPDATE users SET addresses=? WHERE id=?').bind(JSON.stringify(list), user.id).run();
  return list;
}

export async function setPassword(env, user, pw) {
  if (String(pw || '').length < 6) throw new Error('Password must be at least 6 characters.');
  await env.DB.prepare('UPDATE users SET pass=? WHERE id=?').bind(await hashPassword(String(pw)), user.id).run();
}
export { rand, sha, ipOf };
