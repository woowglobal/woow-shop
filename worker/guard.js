// Cost & bot guard. Only PAID store lookups are gated — browsing saved products always works.
// A visitor loses paid lookups (and is listed in Admin → Dashboard → Security) when:
//  • it looks like a bot (script user-agent, no browser headers, no visitor id), or
//  • more than `browsePer30` searches/product views in 30 minutes, or
//  • more than `paidPer30` paid lookups in 30 minutes (signed-in) / `guestPaidPer30` (guest), or
//  • more than `ipPaidPer30` paid lookups from one IP in 30 minutes.
// Blocks last `blockHours`; the admin can unblock.
const BOT_RE = /bot|crawl|spider|slurp|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http|java\/|libwww|scrapy|headless|phantom|selenium|puppeteer|playwright|postman|insomnia/i;
export const GUARD_DEFAULTS = { browsePer30: 50, paidPer30: 50, guestPaidPer30: 15, ipPaidPer30: 100, blockHours: 6 };

export function makeGate(env, req, user, settings = {}) {
  const g = { ...GUARD_DEFAULTS, ...(settings.guard || {}) };
  const ua = req.headers.get('user-agent') || '', sid = (req.headers.get('x-sid') || '').slice(0, 40);
  const ip = req.headers.get('cf-connecting-ip') || '';
  const who = user ? 'u:' + user.id : sid ? 's:' + sid : 'ip:' + ip;
  const looksBot = !ua || BOT_RE.test(ua) || !req.headers.get('accept-language') || !sid;
  let memo = null;
  const gate = {
    who, ip, sid, userId: user?.id || null, bot: looksBot,
    async allow() {
      if (memo !== null) return memo;
      memo = await check();
      return memo;
    },
  };
  async function block(reason) {
    const until = Date.now() + g.blockHours * 3600e3;
    await env.DB.prepare('INSERT INTO guard_block (who,until,reason,at) VALUES (?,?,?,?) ON CONFLICT(who) DO UPDATE SET until=excluded.until, reason=excluded.reason, at=excluded.at, hits=hits+1')
      .bind(who, until, reason + (ip ? ' · IP ' + ip : ''), Date.now()).run().catch(() => {});
    return false;
  }
  async function check() {
    if (!env.ZINC_API_KEY) return true;
    if (looksBot) return false; // bots never cost money (no block row, they just get saved data)
    const since = Date.now() - 30 * 60000;
    try {
      const b = await env.DB.prepare('SELECT until FROM guard_block WHERE who=? OR who=?').bind(who, 'ip:' + ip).first();
      if (b && b.until > Date.now()) return false;
      const [paid, ipPaid, browse] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) n FROM zinc_calls WHERE who=? AND ts>? AND cost_cents>0').bind(who, since).first(),
        env.DB.prepare('SELECT COUNT(*) n FROM zinc_calls WHERE ip=? AND ts>? AND cost_cents>0').bind(ip, since).first(),
        sid ? env.DB.prepare("SELECT COUNT(*) n FROM track WHERE sid=? AND ts>? AND type IN ('search','view','compare','link')").bind(sid, since).first() : { n: 0 },
      ]);
      if (paid.n >= (user ? g.paidPer30 : g.guestPaidPer30)) return block(`${paid.n} paid lookups in 30 min`);
      if (ip && ipPaid.n >= g.ipPaidPer30) { await env.DB.prepare('INSERT OR REPLACE INTO guard_block (who,until,reason,at) VALUES (?,?,?,?)').bind('ip:' + ip, Date.now() + g.blockHours * 3600e3, `${ipPaid.n} paid lookups from one IP in 30 min`, Date.now()).run().catch(() => {}); return false; }
      if (browse.n > g.browsePer30) return block(`${browse.n} searches/views in 30 min`);
      return true;
    } catch (e) { console.log('guard check failed', e.message); return true; }
  }
  return gate;
}
