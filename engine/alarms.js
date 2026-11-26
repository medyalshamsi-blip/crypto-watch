// 24/7 alarm engine for the crypto-watch dashboard. Runs on GitHub Actions every 15 minutes.
// Read-only: public Binance market data in, data/alarms.json out. No keys, no orders.
const fs = require('fs'), path = require('path');
const P = require('./playbook.js'), { mainRead, ta, fp } = require('./ta.js');

const DAY = 864e5, ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'data', 'alarms.json');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com'];
const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8'));
const SPIKE = 2;                                   // volume vs its 20-day average, same as the dashboard
const KEEP_ALERTS = 300, KEEP_KEYS = 14 * DAY, HEARTBEAT = 3 * 3600e3;

const pct = x => (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%';
const day = t => new Date(t).toISOString().slice(0, 10);
const cut = (d, j) => Object.fromEntries(Object.entries(d).map(([k, a]) => [k, a.slice(0, j + 1)]));
// the triggers a candle faced while it traded: candles up to it, with it held flat at the previous close
// (so swings it confirms count, as on the dashboard, but its own moves do not)
function facing(d, j) { const x = cut(d, j), p = d.c[j - 1]; x.o[j] = x.h[j] = x.l[j] = x.c[j] = p; x.v[j] = 0; if (x.tb) x.tb[j] = 0; return x; }

async function klines(sym, limit) {
  let err;
  for (const h of HOSTS) {
    try {
      const r = await fetch(`${h}/api/v3/klines?symbol=${sym}&interval=1d&limit=${limit}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 400) { const e = new Error('not on Binance spot'); e.final = true; throw e; }
      if (!r.ok) throw new Error(`${new URL(h).host} HTTP ${r.status}`);
      const a = await r.json(), d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] };
      for (const k of a) { d.t.push(+k[0]); d.o.push(+k[1]); d.h.push(+k[2]); d.l.push(+k[3]); d.c.push(+k[4]); d.v.push(+k[5]); d.tb.push(+k[9]); }
      return { d, host: new URL(h).host };
    } catch (e) { if (e.final) throw e; err = e; }
  }
  throw err;
}

// every alarm the dashboard can raise from daily candles, for one coin
function check(c, d, now) {
  const out = [], n = d.c.length; if (n < 80) return out;
  const closed = cut(d, n - 2), m = n - 1, lc = closed.c[m - 1], lt = closed.t[m - 1];
  const r0 = P.scan(facing(d, n - 2), c), rc = P.scan(facing(d, n - 1), c);
  const add = (type, dayT, text, strong) => out.push({ key: `${c}|${type}|${day(dayT)}`, coin: c, type, text, strong });
  // 1. daily close through a trigger (the playbook's confirmed signal)
  if (lc > r0.bullTrigger) add('close-up', lt, `${c} closed ${day(lt)} at ${fp(lc)}, above the bull trigger ${fp(r0.bullTrigger)}`, true);
  if (lc < r0.bearTrigger) add('close-down', lt, `${c} closed ${day(lt)} at ${fp(lc)}, below the bear trigger ${fp(r0.bearTrigger)}`, true);
  // 2. today's candle trading through a trigger it started on the other side of (needs a close to count)
  const th = d.h[n - 1], tl = d.l[n - 1], tt = d.t[n - 1], px = d.c[n - 1];
  if (lc <= rc.bullTrigger && th > rc.bullTrigger) add('touch-up', tt, `${c} is trading above the bull trigger ${fp(rc.bullTrigger)} (now ${fp(px)}); it needs a daily close to count`, false);
  if (lc >= rc.bearTrigger && tl < rc.bearTrigger) add('touch-down', tt, `${c} is trading below the bear trigger ${fp(rc.bearTrigger)} (now ${fp(px)}); it needs a daily close to count`, false);
  // 3. volume spike on the last closed candle
  const rv = P.relPrior(closed.v)[m - 1];
  if (rv >= SPIKE) {
    const buy = closed.tb[m - 1] / closed.v[m - 1], green = closed.c[m - 1] > closed.o[m - 1], bias = mainRead(closed).bias;
    const notBull = (green || buy > .5) && bias !== 'Bullish';
    add('spike', lt, `${c} daily volume ${rv.toFixed(1)}× its 20-day average on ${day(lt)}, ${Math.round(buy * 100)}% taker buys, ${green ? 'green' : 'red'} candle${notBull ? '; not bullish yet' : ''}`, false);
  }
  // 4. structure break or breakout on the last closed candle
  const Z = ta(closed), e = Z.events[Z.events.length - 1], b = Z.brk[Z.brk.length - 1];
  if (e && e.t === m - 1) add('struct-' + (e.up ? 'up' : 'down'), lt, `${c} daily ${e.kind} ${e.up ? 'up' : 'down'}: closed ${day(lt)} at ${fp(lc)} ${e.up ? 'above' : 'below'} the swing at ${fp(e.p)}`, e.kind === 'CHoCH');
  if (b && b.t === m - 1) add('brk-' + (b.up ? 'up' : 'down'), lt, `${c} daily breakout ${b.up ? 'up' : 'down'} ${b.kind === 'level' ? 'through a support / resistance area' : 'out of the 20-day range'} on ${day(lt)}${Z.hasV ? (b.vol ? `, volume ${b.rv.toFixed(1)}× average` : ', on low volume') : ''}`, false);
  return out;
}

async function main() {
  const now = Date.now(), old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  const fired = Object.fromEntries(Object.entries(old.fired || {}).filter(([, t]) => now - t < KEEP_KEYS));
  const seeding = !old.fired;                       // first run: remember today's signals without ringing for all of them
  const coins = [...COINS.focus, ...COINS.rest.filter(c => !COINS.focus.includes(c))];
  const fresh = [], failed = {}, hosts = new Set(); let scanned = 0;
  for (let i = 0; i < coins.length; i += 6) {
    const part = coins.slice(i, i + 6), res = await Promise.allSettled(part.map(c => klines(c + 'USDT', 500)));
    res.forEach((r, j) => {
      const c = part[j];
      if (r.status === 'rejected') { failed[c] = r.reason.message; return; }
      hosts.add(r.value.host); scanned++;
      try { for (const a of check(c, r.value.d, now)) if (!fired[a.key]) { fired[a.key] = now; if (!seeding) fresh.push(Object.assign({ at: new Date(now).toISOString(), focus: COINS.focus.includes(c) }, a)); } }
      catch (e) { failed[c] = 'scan failed: ' + e.message; }
    });
  }
  const ok = scanned > 0;
  const alerts = [...fresh.sort((a, b) => b.strong - a.strong), ...(old.alerts || [])].slice(0, KEEP_ALERTS);
  const failKey = JSON.stringify(Object.keys(failed).sort()), oldFail = JSON.stringify(Object.keys(old.failed || {}).sort());
  const due = !old.heartbeat || now - Date.parse(old.heartbeat) >= HEARTBEAT;
  if (fresh.length || failKey !== oldFail || due || seeding || ok !== old.ok) {
    const doc = { about: 'Written by engine/alarms.js on GitHub Actions. Read by the dashboard and by the Claude alarm relay. Not financial advice.',
      heartbeat: new Date(now).toISOString(), ok, scanned, of: coins.length, source: [...hosts].join(', ') || null, failed, alerts, fired };
    if (ok) doc.lastSuccess = doc.heartbeat; else doc.lastSuccess = old.lastSuccess || null;
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n');
  }
  console.log(`scanned ${scanned}/${coins.length}, new alerts ${fresh.length}${seeding ? ' (first run: signals remembered, not rung)' : ''}, failed ${Object.keys(failed).length}${Object.keys(failed).length ? ': ' + Object.entries(failed).map(([c, e]) => c + ' ' + e).join('; ') : ''}`);
  for (const a of fresh) console.log((a.strong ? '!! ' : '   ') + a.text);
  if (!ok) process.exitCode = 1;                   // a red run in the Actions tab when Binance cannot be reached at all
}
main().catch(e => { console.error(e); process.exitCode = 1; });
