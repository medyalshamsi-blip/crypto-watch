// 24/7 log of the breakout-and-retest setups (4H early warning → 15m breakout → retest → paper trade).
// Runs on GitHub Actions every hour. Read-only: public Binance candles in, data/setups/*.jsonl and data/setups.json out.
// Every event is found by replaying closed 15m candles with only the information known at each close, so a run
// never uses the future; "seen" records when this log first wrote the event, which proves it for live events.
const fs = require('fs'), path = require('path');
const SETUPS = require('./setups.js');

const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'data', 'setups'), OUT = path.join(ROOT, 'data', 'setups.json');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com'];
const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8'));
const M15 = 900e3, DAY = 864e5, MIN_VOL = 1e6, MAX_COINS = 200, LOOKBACK_DAYS = 3;
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD|RLUSD|USDE|EURI|USDS|USDJ|XAUT)USDT$|^[A-Z0-9]+(UP|DOWN|BULL|BEAR)USDT$/;
const CRYPTO_B = new Set(['BNB', 'DGB', 'TRB', 'CKB', 'ARB', 'SHIB', 'BB', 'YB']);
const isStock = s => { const b = s.replace(/USDT$/, ''); return /B$/.test(b) && b.length >= 3 && !CRYPTO_B.has(b); };
const isStable = x => Math.abs(+x.lastPrice - 1) < 0.01 && +x.lowPrice > 0 && +x.highPrice / +x.lowPrice < 1.01;
let host = null;

async function get(p) {
  let err;
  for (const h of host ? [host, ...HOSTS.filter(x => x !== host)] : HOSTS) {
    try {
      const r = await fetch(h + p, { signal: AbortSignal.timeout(20000) });
      if (r.status === 400) { const e = new Error('not on Binance spot'); e.final = true; throw e; }
      if (!r.ok) throw new Error(`${new URL(h).host} HTTP ${r.status}`);
      host = h; return await r.json();
    } catch (e) { if (e.final) throw e; err = e; }
  }
  throw err;
}
const parse = a => { const d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }; for (const k of a) { d.t.push(+k[0]); d.o.push(+k[1]); d.h.push(+k[2]); d.l.push(+k[3]); d.c.push(+k[4]); d.v.push(+k[5]); d.tb.push(+k[9]); } return d; };
async function candles(sym) {                       // about 20 days of closed 15m candles
  const a = parse(await get(`/api/v3/klines?symbol=${sym}&interval=15m&limit=1000`));
  if (!a.t.length) throw new Error('no candles');
  const b = parse(await get(`/api/v3/klines?symbol=${sym}&interval=15m&limit=1000&endTime=${a.t[0] - 1}`));
  const d = {}; for (const k of Object.keys(a)) d[k] = b[k].concat(a[k]);
  while (d.t.length && d.t[d.t.length - 1] + M15 > Date.now()) for (const k of Object.keys(d)) d[k].pop();   // closed candles only
  return d;
}
async function pool(items, k, fn) { const out = []; for (let i = 0; i < items.length; i += k) out.push(...await Promise.all(items.slice(i, i + k).map(fn))); return out; }
const ema = (a, n) => { const q = 2 / (n + 1), o = [a[0]]; for (let i = 1; i < a.length; i++) o.push(a[i] * q + o[i - 1] * (1 - q)); return o; };
function btcTrend(btc) {                            // BTC 4H close above or below its EMA50, at any time
  const d4 = SETUPS.to4H(btc, btc.c.length), e = ema(d4.c, 50);
  return t => { let k = -1; for (let i = 0; i < d4.t.length && d4.t[i] + 4 * 3600e3 <= t; i++) k = i; return k < 50 ? 'unknown' : d4.c[k] > e[k] ? 'up' : 'down'; };
}
const dayOf = t => new Date(t).toISOString().slice(0, 10);
function readDays(fromT) {
  const ev = []; if (!fs.existsSync(DIR)) return ev;
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) {
    if (fromT && f.slice(0, 10) < dayOf(fromT)) continue;
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) if (line.trim()) ev.push(JSON.parse(line));
  }
  return ev;
}
// everything the replay says happened on one coin, as events with stable ids
function events(coin, r, r2, trend, wl) {
  const out = [], add = e => out.push(Object.assign({ id: `${coin}|${e.type}|${e.t}`, coin, wl }, e));
  for (const a of r.alerts) add({ type: a.v === 'full' ? 'warn-full' : 'warn-simple', t: a.t, lv: a.lv, dist: +a.dist.toFixed(3) });
  for (const b of r.brks) {
    add({ type: 'breakout', t: b.t, lv: b.lv, close: b.close, vm: +b.vm.toFixed(2), tb: b.tb == null || isNaN(b.tb) ? null : +b.tb.toFixed(3), atr4: b.atr4, simpleAt: b.base, fullAt: b.full });
    if (!b.spikeOpen) add({ type: 'breakout-result', t: b.t, of: `${coin}|breakout|${b.t}`, spike: b.spike, spikeAt: b.spikeT || null, retest: b.state });
    const tr = b.trade; if (!tr) continue;
    if (tr.skip) { add({ type: 'retest-skip', t: tr.t, of: `${coin}|breakout|${b.t}`, why: tr.skip }); continue; }
    if (!tr.plain || tr.pending) continue;
    add({ type: 'entry', t: tr.t, of: `${coin}|breakout|${b.t}`, entry: tr.entry, stop: tr.stop, target: tr.target, rr: Number.isFinite(tr.rr) ? +tr.rr.toFixed(2) : null, costR: +tr.costR.toFixed(3), full: tr.fullOk, btc: trend(tr.t) });
    if (tr.exit) { const x2 = r2 && r2.brks.find(y => y.t === b.t && y.trade && y.trade.exit); add({ type: 'exit', t: tr.exit.t, of: `${coin}|entry|${tr.t}`, why: tr.exit.why, px: tr.exit.px, r: +tr.exit.r.toFixed(3), r2: x2 ? +x2.trade.exit.r.toFixed(3) : null }); }
  }
  for (const b of r.brks) if (b.state === 'failed') add({ type: 'retest-fail', t: b.failT, of: `${coin}|breakout|${b.t}`, lv: b.lv });
  return out;
}
// fast 15m pings on watchlist coins (rules in setups.js): the ping, its 2-hour result, and every 5%-in-an-hour spike
function pingEvents(coin, x) {
  const out = [], add = e => out.push(Object.assign({ id: `${coin}|${e.type}|${e.t}`, coin, wl: true }, e)), f = (v, d) => +v.toFixed(d);
  for (const q of x.pings) {
    add({ type: 'ping', t: q.t, price: q.price, r: f(q.r, 4), vm: f(q.vm, 2), buy: Number.isFinite(q.buy) ? f(q.buy, 3) : null, aboveVwap: q.aboveVwap, above16: q.above16, confirmed: q.confirmed });
    if (q.done) add({ type: 'ping-result', t: q.t, of: `${coin}|ping|${q.t}`, spikeAt: q.spikeAt, maxUp: Number.isFinite(q.maxUp) ? f(q.maxUp, 4) : null });
  }
  for (const k of x.spikes) add({ type: 'spike5', t: k.t, gain: f(k.gain, 4) });
  return out;
}
function pingScoreLog(ev, since) {                  // the same numbers as SETUPS.pingScore, from logged events (live only)
  const live = ev.filter(e => e.t >= since && !e.backfill), res = {}; for (const e of live) if (e.type === 'ping-result') res[e.of] = e;
  const pings = live.filter(e => e.type === 'ping'), done = pings.filter(e => res[e.id]), spikes = live.filter(e => e.type === 'spike5'), lead = [];
  for (const sp of spikes) { const first = pings.filter(p => p.coin === sp.coin && p.t >= sp.t - 8 * M15 && p.t < sp.t).sort((a, b) => a.t - b.t)[0]; if (first) lead.push((sp.t - first.t) / 60e3); }
  const hit = done.filter(e => res[e.id].spikeAt).length, sl = lead.sort((a, b) => a - b);
  return { pings: done.length, open: pings.length - done.length, followed: hit, hitRate: done.length ? +(hit / done.length).toFixed(4) : null, spikes: spikes.length, caught: lead.length, caughtShare: spikes.length ? +(lead.length / spikes.length).toFixed(4) : null, leadMin: sl.length ? sl[sl.length >> 1] : null };
}
// the strategy's two tables, from the log
function score(ev, since) {
  const live = ev.filter(e => e.t >= since), by = {}; for (const e of ev) by[e.id] = e;
  const res = {}; for (const e of ev) if (e.type === 'breakout-result') res[e.of] = e;
  const brk = live.filter(e => e.type === 'breakout'), med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const spikes = brk.filter(b => res[b.id] && res[b.id].spike);
  const scan = v => { const al = live.filter(e => e.type === v); let hit = 0; const lead = [];
    for (const a of al) { const b = brk.find(x => x.coin === a.coin && x.lv === a.lv && x.t >= a.t && x.t - a.t <= DAY); if (b && res[b.id] && res[b.id].spike) { hit++; lead.push((b.t - a.t) / 3600e3); } }
    const key = v === 'warn-full' ? 'fullAt' : 'simpleAt';
    return { alerts: al.length, ledToSpike: al.length ? +(hit / al.length).toFixed(3) : null, spikesWarned: spikes.length ? +(spikes.filter(b => b[key] != null).length / spikes.length).toFixed(3) : null, medianLeadH: med(lead) }; };
  const exits = {}; for (const e of ev) if (e.type === 'exit') exits[e.of] = e;
  const trades = (f, slip2) => { const a = live.filter(e => e.type === 'entry' && f(e) && exits[e.id]).map(e => ({ coin: e.coin, t: e.t, btc: e.btc, why: exits[e.id].why, r: slip2 ? (exits[e.id].r2 ?? exits[e.id].r) : exits[e.id].r })).sort((x, y) => x.t - y.t);
    let cum = 0, peak = 0, dd = 0; for (const x of a) { cum += x.r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
    const best = a.length ? Math.max(...a.map(x => x.r)) : 0, grp = k => { const g = {}; for (const x of a) { const key = x[k]; g[key] = g[key] || { n: 0, r: 0 }; g[key].n++; g[key].r += x.r; } for (const v of Object.values(g)) v.r = +v.r.toFixed(2); return g; };
    return { n: a.length, target: a.filter(x => x.why === 'target').length, stop: a.filter(x => x.why === 'stop').length, time: a.filter(x => x.why === 'time').length, avgR: a.length ? +(cum / a.length).toFixed(3) : null, totalR: +cum.toFixed(2), maxDrawdownR: +dd.toFixed(2), totalWithoutBestR: +(cum - best).toFixed(2), byBtcTrend: grp('btc'), byCoin: grp('coin') }; };
  return { since: new Date(since).toISOString(), spikes: spikes.length, breakouts: brk.length,
    scanner: { simple: scan('warn-simple'), full: scan('warn-full') },
    trade: { plain: trades(() => true), full: trades(e => e.full), plainDoubleSlippage: trades(() => true, true), fullDoubleSlippage: trades(e => e.full, true) },
    notes: { failedRetests: live.filter(e => e.type === 'retest-fail').length, skippedRetests: live.filter(e => e.type === 'retest-skip').length, openOrPending: live.filter(e => e.type === 'entry' && !exits[e.id]).length } };
}

(async () => {
  const now = Date.now(), wl = new Set([...COINS.focus, ...COINS.rest].map(c => c + 'USDT'));
  const tk = await get('/api/v3/ticker/24hr'), alive = x => +x.count > 0 && +x.closeTime > now - 3 * 3600e3;
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && !SKIP.test(x.symbol) && !isStable(x) && !isStock(x.symbol) && +x.quoteVolume >= MIN_VOL && alive(x)).sort((a, b) => b.quoteVolume - a.quoteVolume).map(x => x.symbol);
  const live = new Set(tk.filter(alive).map(x => x.symbol));
  const syms = [...new Set(['BTCUSDT', ...[...wl].filter(s => live.has(s)), ...uni])].slice(0, MAX_COINS);
  const failed = {}, data = {};
  await pool(syms, 8, async s => { try { data[s] = await candles(s); } catch (e) { failed[s] = e.message; } });
  if (!data.BTCUSDT) throw new Error('BTC candles missing: ' + (failed.BTCUSDT || 'unknown'));
  const trend = btcTrend(data.BTCUSDT), status = {};
  const old = readDays(now - LOOKBACK_DAYS * DAY), known = new Set(old.map(e => e.id));
  const first = !fs.existsSync(DIR) || !fs.readdirSync(DIR).some(f => f.endsWith('.jsonl'));
  const prev0 = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}, pingFirst = !prev0.pings;
  let fresh = []; const pg = {};
  for (const s of syms) {
    const d = data[s]; if (!d || s === 'BTCUSDT') continue; let r, r2;
    try { r = SETUPS.replay(d); r2 = SETUPS.replay(d, { slip: SETUPS.DEF.slip * 2 }); } catch (e) { failed[s] = 'replay: ' + e.message; continue; }
    if (!r) { failed[s] = 'too few candles'; continue; }
    const coin = s.replace(/USDT$/, '');
    if (r.status) { const b = r.lastBrk, t = b && b.trade; status[coin] = { status: r.status, wl: wl.has(s) || undefined, ceiling: b && ['await', 'entry', 'extended', 'failed', 'skipped', 'done'].includes(r.status) ? b.lv : r.last.ceil ? r.last.ceil.lv : null, price: r.last.price, entry: t && r.status === 'entry' ? t.entry : undefined, stop: t && r.status === 'entry' ? t.stop : undefined, target: t && r.status === 'entry' ? t.target : undefined }; }
    try { pg[s] = SETUPS.pings(d); } catch (e) { pg[s] = null; }
    const pe = wl.has(s) && pg[s] ? pingEvents(coin, pg[s]) : [];
    for (const e of events(coin, r, r2, trend, wl.has(s) || undefined).concat(pe)) {
      if (known.has(e.id)) continue;
      if (!first && e.t < now - LOOKBACK_DAYS * DAY) continue;     // older than the overlap window: belongs to the backfill
      e.seen = now; if (first || (pingFirst && /^(ping|spike5)/.test(e.type))) e.backfill = true; fresh.push(e); known.add(e.id);
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const byDay = {}; for (const e of fresh) (byDay[dayOf(e.t)] = byDay[dayOf(e.t)] || []).push(e);
  for (const [d, list] of Object.entries(byDay)) fs.appendFileSync(path.join(DIR, d + '.jsonl'), list.sort((a, b) => a.t - b.t).map(e => JSON.stringify(e)).join('\n') + '\n');
  const all = readDays(null), prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const since = prev.liveSince ? Date.parse(prev.liveSince) : now;
  const pingSince = prev.pings && prev.pings.since ? Date.parse(prev.pings.since) : now, wlList = Object.keys(pg).filter(s => wl.has(s));
  const isPing = e => /^(ping|spike5)/.test(e.type), r4 = z => Object.fromEntries(Object.entries(z).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : Number.isNaN(v) ? null : v]));
  const doc = { about: 'Written by engine/setups-log.js on GitHub Actions every hour: breakout-and-retest setups replayed on closed Binance 15m candles. Read by the dashboard and the Claude alarm relay. Paper trades only. Not financial advice.',
    updated: new Date(now).toISOString(), liveSince: new Date(since).toISOString(), source: host ? new URL(host).host : null, coins: Object.keys(data).length, failed,
    rules: SETUPS.DEF, status, live: score(all, since), withBackfill: score(all, 0),
    latest: all.filter(e => !isPing(e) && (e.seen >= now - 3 * 3600e3 || e.t >= now - 3 * 3600e3)).sort((a, b) => b.t - a.t).slice(0, 80),
    pings: { about: 'Fast 15m pings (look at the chart, not an entry): 15m close >= +0.75% on >= 2x the 20-candle average volume, one per coin per hour; scored against 5%-in-an-hour spikes within 2 hours. Logged for watchlist coins; last20Days replays every coin in this log.',
      rules: SETUPS.PING, since: new Date(pingSince).toISOString(), coins: Object.keys(pg).length, watchlistCoins: wlList.length,
      live: { watchlist: pingScoreLog(all, pingSince) },
      last20Days: { watchlist: r4(SETUPS.pingScore(wlList.map(s => pg[s]))), all: r4(SETUPS.pingScore(Object.values(pg))) },
      recent: all.filter(e => e.type === 'ping' && e.t >= now - DAY).sort((a, b) => b.t - a.t).slice(0, 60) } };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`coins ${doc.coins}, new events ${fresh.length}${first ? ' (first run: backfill of about 20 days)' : ''}, failed ${Object.keys(failed).length}; live trades ${doc.live.trade.plain.n} (plain) / ${doc.live.trade.full.n} (full)`);
})().catch(e => { console.error(e); process.exit(1); });
