// One-click sign-in: Google, Apple, WhatsApp code. Every WOOW account is anchored to ONE mobile number,
// so the same customer is recognised whether they come with Gmail, Apple or WhatsApp.
//  • Google / Apple: matched by their account id, then by verified email; a brand-new Google/Apple customer
//    adds their mobile once (verified on WhatsApp when available) — if that mobile already has an account,
//    the Google/Apple login is linked to it instead of creating a second account.
//  • WhatsApp: 6-digit code sent to the mobile on WhatsApp → signs in (or creates the account).
// Setup (Cloudflare secrets/vars): GOOGLE_CLIENT_ID · APPLE_CLIENT_ID · WA_TOKEN + WA_PHONE_ID (+ WA_OTP_TEMPLATE, WA_OTP_LANG)
import { bdPhone, newSession, rand, sha, ipOf, tooManyFails, addFail } from './auth.js';

const JWKS = { google: 'https://www.googleapis.com/oauth2/v3/certs', apple: 'https://appleid.apple.com/auth/keys' };
const ISS = { google: ['accounts.google.com', 'https://accounts.google.com'], apple: ['https://appleid.apple.com'] };
const keyCache = {};
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function jwks(provider) {
  const c = keyCache[provider];
  if (c && Date.now() - c.at < 3600e3) return c.keys;
  const r = await fetch(JWKS[provider]); const keys = (await r.json()).keys || [];
  keyCache[provider] = { at: Date.now(), keys }; return keys;
}
export async function verifyIdToken(provider, token, aud) {
  const [h, p, sig] = String(token || '').split('.');
  if (!h || !p || !sig) throw new Error('Sign-in failed. Please try again.');
  const head = JSON.parse(new TextDecoder().decode(b64u(h))), body = JSON.parse(new TextDecoder().decode(b64u(p)));
  const jwk = (await jwks(provider)).find((k) => k.kid === head.kid);
  if (!jwk || head.alg !== 'RS256') throw new Error('Sign-in failed. Please try again.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(h + '.' + p));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || !ISS[provider].includes(body.iss) || (Array.isArray(body.aud) ? !body.aud.includes(aud) : body.aud !== aud) || body.exp < now - 60) throw new Error('Sign-in failed. Please try again.');
  return body;
}

const ME_COLS = 'id, phone, name, email, google_sub, apple_sub, disabled';
async function byPhone(env, phone) { return env.DB.prepare(`SELECT ${ME_COLS} FROM users WHERE phone=?`).bind(phone).first(); }
async function link(env, userId, fields) {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined && fields[k] !== null && fields[k] !== '');
  if (!cols.length) return;
  await env.DB.prepare(`UPDATE users SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`).bind(...cols.map((c) => fields[c]), userId).run();
}
async function createUser(env, { phone, name, email, google_sub, apple_sub, verified }) {
  const id = 'U' + rand(6);
  await env.DB.prepare('INSERT INTO users (id,phone,name,email,pass,addresses,created_at,google_sub,apple_sub,phone_verified) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, phone, String(name || 'WOOW customer').slice(0, 80), email || null, '', '[]', new Date().toISOString(), google_sub || null, apple_sub || null, verified ? 1 : 0).run();
  return id;
}
const done = async (env, req, userId) => ({ token: await newSession(env, req, userId) });

/** Google / Apple: returns { token } when signed in, or { pending, name, email } when we still need the mobile number. */
export async function socialLogin(env, req, provider, credential, extraName) {
  const aud = provider === 'google' ? env.GOOGLE_CLIENT_ID : env.APPLE_CLIENT_ID;
  if (!aud) throw new Error('This sign-in option is not switched on yet.');
  const t = await verifyIdToken(provider, credential, aud);
  const subCol = provider === 'google' ? 'google_sub' : 'apple_sub';
  const email = t.email && (t.email_verified === true || t.email_verified === 'true') ? String(t.email).toLowerCase() : null;
  let u = await env.DB.prepare(`SELECT ${ME_COLS} FROM users WHERE ${subCol}=?`).bind(t.sub).first();
  if (!u && email) { u = await env.DB.prepare(`SELECT ${ME_COLS} FROM users WHERE lower(email)=?`).bind(email).first(); if (u) await link(env, u.id, { [subCol]: t.sub }); }
  if (u) { if (u.disabled) throw new Error('This account is paused. Please call WOOW: +88 09649-223322.'); return done(env, req, u.id); }
  const name = String(t.name || extraName || (email ? email.split('@')[0] : 'WOOW customer')).slice(0, 80);
  const pending = 'P' + rand(12);
  await env.DB.prepare('INSERT INTO pending_auth (id,data,expires) VALUES (?,?,?)').bind(pending, JSON.stringify({ provider, sub: t.sub, email, name }), Date.now() + 20 * 60000).run();
  return { pending, name, email };
}
async function takePending(env, id) {
  if (!id) return null;
  const r = await env.DB.prepare('SELECT data, expires FROM pending_auth WHERE id=?').bind(id).first();
  if (!r || r.expires < Date.now()) throw new Error('Sign-in took too long. Please start again.');
  return JSON.parse(r.data);
}
const subFields = (pd) => (pd ? { [pd.provider === 'google' ? 'google_sub' : 'apple_sub']: pd.sub } : {});

/** Google/Apple sign-up finished WITHOUT WhatsApp verification (only when WhatsApp codes are not set up). */
export async function completeWithoutCode(env, req, pendingId, phoneRaw) {
  const pd = await takePending(env, pendingId), phone = bdPhone(phoneRaw);
  if (!phone) throw new Error('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
  if (await byPhone(env, phone)) throw new Error('This mobile already has a WOOW account. Sign in with it once (mobile + password), then link Google/Apple from your account.');
  const id = await createUser(env, { phone, name: pd.name, email: pd.email, ...subFields(pd) });
  await env.DB.prepare('DELETE FROM pending_auth WHERE id=?').bind(pendingId).run();
  return done(env, req, id);
}

// ── WhatsApp codes ──
export const waReady = (env) => !!(env.WA_TOKEN && env.WA_PHONE_ID) || env.DEV_OTP === 'true';
export async function sendCode(env, req, phoneRaw) {
  const phone = bdPhone(phoneRaw);
  if (!phone) throw new Error('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
  if (!waReady(env)) throw new Error('WhatsApp sign-in is not switched on yet.');
  if (await tooManyFails(env, [['wa:' + phone, 4], ['waip:' + ipOf(req), 12]])) throw new Error('Too many codes. Please wait 15 minutes.');
  await addFail(env, 'wa:' + phone); await addFail(env, 'waip:' + ipOf(req));
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await env.DB.prepare('INSERT OR REPLACE INTO otp (phone,code,expires,tries) VALUES (?,?,?,0)').bind(phone, await sha(phone + ':' + code), Date.now() + 10 * 60000).run();
  if (env.WA_TOKEN && env.WA_PHONE_ID) {
    const r = await fetch(`https://graph.facebook.com/v20.0/${env.WA_PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: '88' + phone, type: 'template', template: { name: env.WA_OTP_TEMPLATE || 'woow_login_code', language: { code: env.WA_OTP_LANG || 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }] } }),
    });
    if (!r.ok) { console.log('whatsapp send failed', r.status, await r.text()); throw new Error('Could not send the WhatsApp code. Is WhatsApp active on this number?'); }
    return { sent: true };
  }
  return { sent: true, devCode: code }; // local testing only (DEV_OTP=true)
}
async function checkCode(env, phone, code) {
  const r = await env.DB.prepare('SELECT code, expires, tries FROM otp WHERE phone=?').bind(phone).first();
  if (!r || r.expires < Date.now()) throw new Error('The code has expired. Please ask for a new one.');
  if (r.tries >= 5) throw new Error('Too many wrong codes. Please ask for a new one.');
  if (r.code !== (await sha(phone + ':' + String(code || '').trim()))) { await env.DB.prepare('UPDATE otp SET tries=tries+1 WHERE phone=?').bind(phone).run(); throw new Error('Wrong code. Please check WhatsApp and try again.'); }
}
/** WhatsApp code → signed in. Also finishes a Google/Apple sign-up (pending) and links it to an existing account with that mobile. */
export async function verifyCode(env, req, b) {
  const phone = bdPhone(b.phone);
  if (!phone) throw new Error('Please enter a valid Bangladeshi mobile number (01XXXXXXXXX).');
  await checkCode(env, phone, b.code);
  const pd = await takePending(env, b.pending);
  let u = await byPhone(env, phone);
  if (u) {
    if (u.disabled) throw new Error('This account is paused. Please call WOOW: +88 09649-223322.');
    await link(env, u.id, { ...subFields(pd), email: !u.email && pd?.email ? pd.email : undefined, phone_verified: 1 });
  } else {
    const name = pd?.name || String(b.name || '').trim();
    if (name.length < 2) return { needName: true }; // code stays valid; ask the name, then verify again
    u = { id: await createUser(env, { phone, name, email: pd?.email || String(b.email || '').trim().toLowerCase() || null, ...subFields(pd), verified: true }) };
  }
  await env.DB.prepare('DELETE FROM otp WHERE phone=?').bind(phone).run();
  if (b.pending) await env.DB.prepare('DELETE FROM pending_auth WHERE id=?').bind(b.pending).run();
  return done(env, req, u.id);
}
/** Signed-in customer links Google/Apple to their current account. */
export async function linkSocial(env, user, provider, credential) {
  const aud = provider === 'google' ? env.GOOGLE_CLIENT_ID : env.APPLE_CLIENT_ID;
  const t = await verifyIdToken(provider, credential, aud), col = provider === 'google' ? 'google_sub' : 'apple_sub';
  const other = await env.DB.prepare(`SELECT id FROM users WHERE ${col}=?`).bind(t.sub).first();
  if (other && other.id !== user.id) throw new Error('This ' + (provider === 'google' ? 'Google' : 'Apple') + ' account is already linked to another WOOW account.');
  await link(env, user.id, { [col]: t.sub, email: !user.email && t.email ? String(t.email).toLowerCase() : undefined });
}

// ── admin: open a customer's portal (one-time link, 5 minutes; session lasts 2 hours) ──
export async function adminPortalLink(env, userId) {
  const id = 'X' + rand(16);
  await env.DB.prepare('INSERT INTO pending_auth (id,data,expires) VALUES (?,?,?)').bind(id, JSON.stringify({ imp: userId }), Date.now() + 5 * 60000).run();
  return id;
}
export async function useAdminPortal(env, req, id) {
  const r = await env.DB.prepare('SELECT data, expires FROM pending_auth WHERE id=?').bind(String(id || '')).first();
  await env.DB.prepare('DELETE FROM pending_auth WHERE id=?').bind(String(id || '')).run();
  if (!r || r.expires < Date.now()) throw new Error('This admin link has expired. Open it again from Admin → Customers.');
  const { imp } = JSON.parse(r.data); if (!imp) throw new Error('Invalid link');
  return { token: await newSession(env, req, imp, { admin: true }) };
}
