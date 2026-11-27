// Walk-forward backtest of the breakout-and-retest strategy (rules in engine/setups.js), run once by hand on GitHub Actions.
// Pre-registered on 27 Nov 2026 before any result was seen:
//   build block  1 Sep – 26 Nov 2026 (contains the INIT, FET and ZRO examples)
//   unseen block 1 May – 31 Aug 2026 (nobody has looked at it)
//   coins: Binance USDT pairs with $1M+ 24-hour volume today plus the watchlist (today's list: survivorship bias), watchlist also reported apart
//   versions: as written; recent squeeze (any of the last 12 4H readings); volume floor; session filter (no new entry 09:30–16:00 New York
//   while BTC's last daily close is under its 50-day average)
//   spike: a 15m close above a marked 4H swing high, then +1 ATR (4H) within 24 h; +3 ATR also reported
//   trades: plain break and retest vs full strategy; costs 0.10% fee + 0.05% slippage per side inside 1R; stop first when unclear
//   verdict: inconclusive when fewer than 30 trades or when the 90% bootstrap interval of the average R includes zero
const fs = require('fs'), path = require('path');
const SETUPS = require('./setups.js');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'data', 'backtest');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8'));
const M15 = 900e3, DAY = 864e5;
const FETCH_FROM = Date.parse('2026-04-01T00:00:00Z'), END = Date.parse('2026-11-27T00:00:00Z');
const BLOCKS = { unseen: [Date.parse('2026-05-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z')], build: [Date.parse('2026-09-01T00:00:00Z'), END] };
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD|RLUSD|USDE|EURI|USDS|USDJ|XAUT)USDT$|^[A-Z0-9]+(UP|DOWN|BULL|BEAR)USDT$/;
const CRYPTO_B = new Set(['BNB', 'DGB', 'TRB', 'CKB', 'ARB', 'SHIB', 'BB', 'YB']);
const isStock = s => { const b = s.replace(/USDT$/, ''); return /B$/.test(b) && b.length >= 3 && !CRYPTO_B.has(b); };
const isStable = x => Math.abs(+x.lastPrice - 1) < 0.01 && +x.lowPrice > 0 && +x.highPrice / +x.lowPrice < 1.01;
let host = null;
const ONE = new Map();   // 1-minute candles already fetched
async function get(p) {
  let err;
  for (let attempt = 0; attempt < 3; attempt++) for (const h of host ? [host, ...HOSTS.filter(x => x !== host)] : HOSTS) {
    try { const r = await fetch(h + p, { signal: AbortSignal.timeout(25000) }); if (r.status === 400) { const e = new Error('not on Binance spot'); e.final = true; throw e; } if (r.status === 429 || r.status === 418) { await new Promise(z => setTimeout(z, 5000)); throw new Error('rate limit'); } if (!r.ok) throw new Error(`HTTP ${r.status}`); host = h; return await r.json(); }
    catch (e) { if (e.final) throw e; err = e; }
  }
  throw err;
}
async function candles(sym, iv, from, to) {
  const d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }; let s = from; const ms = iv === '1m' ? 60e3 : M15;
  while (s < to) { const k = await get(`/api/v3/klines?symbol=${sym}&interval=${iv}&startTime=${s}&endTime=${to - 1}&limit=1000`); if (!k.length) break;
    for (const x of k) { d.t.push(+x[0]); d.o.push(+x[1]); d.h.push(+x[2]); d.l.push(+x[3]); d.c.push(+x[4]); d.v.push(+x[5]); d.tb.push(+x[9]); }
    s = +k[k.length - 1][0] + ms; if (k.length < 1000) break; }
  return d;
}
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');
const nyHM = t => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date(t)); const g = k => p.find(x => x.type === k).value; return { h: +g('hour') % 24, m: +g('minute'), wd: g('weekday') }; };
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function stats(rs) {
  const n = rs.length; if (!n) return { n: 0 };
  const mean = rs.reduce((a, x) => a + x, 0) / n, R = rng(42), bs = [];
  for (let k = 0; k < 2000; k++) { let s = 0; for (let i = 0; i < n; i++) s += rs[Math.floor(R() * n)]; bs.push(s / n); }
  bs.sort((a, b) => a - b); let cum = 0, pk = 0, dd = 0; for (const x of rs) { cum += x; pk = Math.max(pk, cum); dd = Math.max(dd, pk - cum); }
  const best = Math.max(...rs);
  return { n, avgR: +mean.toFixed(3), ci90: [+bs[100].toFixed(3), +bs[1899].toFixed(3)], totalR: +cum.toFixed(2), maxDrawdownR: +dd.toFixed(2), totalWithoutBestR: +(cum - best).toFixed(2), verdict: n < 30 ? 'inconclusive (under 30 trades)' : bs[100] > 0 ? 'positive' : bs[1899] < 0 ? 'negative' : 'inconclusive (interval includes zero)' };
}

(async () => {
  const t0 = Date.now(), wl = new Set([...COINS.focus, ...COINS.rest].map(c => c + 'USDT'));
  const tk = await get('/api/v3/ticker/24hr'), alive = x => +x.count > 0 && +x.closeTime > Date.now() - 3 * 3600e3;
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && !SKIP.test(x.symbol) && !isStable(x) && !isStock(x.symbol) && +x.quoteVolume >= 1e6 && alive(x)).sort((a, b) => b.quoteVolume - a.quoteVolume).map(x => x.symbol);
  const live = new Set(tk.filter(alive).map(x => x.symbol)), syms = [...new Set(['BTCUSDT', ...[...wl].filter(s => live.has(s)), ...uni])].slice(0, 200);
  // BTC: daily closes for the trend label and the session filter
  const btc = await candles('BTCUSDT', '15m', FETCH_FROM - 60 * DAY, END), dclose = new Map();
  for (let i = 0; i < btc.t.length; i++) dclose.set(Math.floor(btc.t[i] / DAY) * DAY, btc.c[i]);
  const days = [...dclose.keys()].sort((a, b) => a - b), below = new Map();
  for (let i = 50; i < days.length; i++) { let s = 0; for (let k = i - 50; k < i; k++) s += dclose.get(days[k]); below.set(days[i], dclose.get(days[i - 1]) < s / 50); }   // known at the day's open
  const btcDown = t => below.get(Math.floor(t / DAY) * DAY) === true;
  const usSession = t => { const x = nyHM(t), mins = x.h * 60 + x.m; return x.wd !== 'Sat' && x.wd !== 'Sun' && mins >= 570 && mins < 960; };
  const VERS = {
    asWritten: {},
    recentSqueeze: { squeezeLook: 12 },
    volumeFloor: { volFloor: true },
    sessionFilter: { noEntry: t => usSession(t) && btcDown(t) },
  };
  const blockOf = t => Object.keys(BLOCKS).find(k => t >= BLOCKS[k][0] && t < BLOCKS[k][1]) || null;
  const signals = [], trades = [], acc = {}, coverage = {}, failed = {};
  const slot = (v, blk, uni) => { const k = `${v}|${blk}|${uni}`; return acc[k] = acc[k] || { alerts: { base: 0, full: 0 }, toSpike: { base: 0, full: 0 }, lead: { base: [], full: [] }, spikes: 0, spikes3: 0, warned: { base: 0, full: 0 }, brk: 0, failed: 0, extended: 0, skipped: {}, plain: [], full: [], plain2: [], full2: [], byTrend: {} }; };
  for (const s of syms) {
    if (s === 'BTCUSDT') continue; let d;
    try { d = await candles(s, '15m', FETCH_FROM, END); } catch (e) { failed[s] = e.message; continue; }
    if (d.t.length < 3000) { failed[s] = `only ${d.t.length} candles`; continue; }
    coverage[s] = { from: iso(d.t[0]), candles: d.t.length, watchlist: wl.has(s) || undefined };
    for (const [v, opt] of Object.entries(VERS)) {
      const r = SETUPS.replay(d, opt), r2 = SETUPS.replay(d, Object.assign({}, opt, { slip: SETUPS.DEF.slip * 2 })); if (!r) continue;
      // resolve candles where the stop and the target were both touched, on 1-minute candles
      for (const b of r.brks) { const x = b.trade && b.trade.exit; if (!x || !x.ambig) continue;
        try { const key = s + '|' + d.t[x.k], one = ONE.get(key) || await candles(s, '1m', d.t[x.k], d.t[x.k] + M15); ONE.set(key, one); for (let i = 0; i < one.t.length; i++) { const hs = one.l[i] <= b.trade.stop, ht = one.h[i] >= b.trade.target; if (hs) break; if (ht) { x.why = 'target'; x.px = Math.max(b.trade.target, one.o[i]); x.r = (x.px * (1 - (SETUPS.DEF.fee + SETUPS.DEF.slip)) - b.trade.entry * (1 + SETUPS.DEF.fee + SETUPS.DEF.slip)) / b.trade.risk; x.resolved = '1m'; const y = r2.brks.find(z => z.t === b.t && z.trade && z.trade.exit); if (y) { y.trade.exit.why = 'target'; y.trade.exit.r = (Math.max(y.trade.target, one.o[i]) * (1 - (SETUPS.DEF.fee + 2 * SETUPS.DEF.slip)) - y.trade.entry * (1 + SETUPS.DEF.fee + 2 * SETUPS.DEF.slip)) / y.trade.risk; } break; } } } catch (e) { x.resolved = 'stop first (1m unavailable)'; } }
      for (const uniK of wl.has(s) ? ['all', 'watchlist'] : ['all']) {
        for (const a of r.alerts) { const blk = blockOf(a.t); if (!blk) continue; const A = slot(v, blk, uniK); A.alerts[a.v]++; const b = r.brks.find(x => x.id === a.id && x.t >= a.t && x.t - a.t <= DAY); if (b && b.spike) { A.toSpike[a.v]++; A.lead[a.v].push((b.t - a.t) / 3600e3); } }
        for (const b of r.brks) { const blk = blockOf(b.t); if (!blk) continue; const A = slot(v, blk, uniK); A.brk++; if (b.spike) { A.spikes++; if (b.base != null) A.warned.base++; if (b.full != null) A.warned.full++; } if (b.spike3) A.spikes3++;
          if (b.state === 'failed') A.failed++; if (b.state === 'extended') A.extended++;
          const t = b.trade; if (t && t.skip) { const why = t.skip.startsWith('R:R') ? 'under 2R to resistance' : t.skip; A.skipped[why] = (A.skipped[why] || 0) + 1; }
          if (t && t.exit && t.plain) { const b2 = r2.brks.find(y => y.t === b.t && y.trade && y.trade.exit), trend = btcDown(t.t) ? 'BTC under 50-day' : 'BTC over 50-day';
            A.plain.push(t.exit.r); A.plain2.push(b2 ? b2.trade.exit.r : t.exit.r); A.byTrend[trend] = A.byTrend[trend] || []; A.byTrend[trend].push(t.exit.r);
            if (t.fullOk) { A.full.push(t.exit.r); A.full2.push(b2 ? b2.trade.exit.r : t.exit.r); }
            if (uniK === 'all') trades.push([v, blk, s, iso(b.t), b.lv, iso(t.t), t.entry, +t.stop.toPrecision(6), +t.target.toPrecision(6), Number.isFinite(t.rr) ? +t.rr.toFixed(2) : 'clear', t.fullOk ? 'full' : 'plain', t.exit.why, iso(t.exit.t), +t.exit.r.toFixed(3), b2 ? +b2.trade.exit.r.toFixed(3) : '', +t.costR.toFixed(3), trend, t.exit.resolved || ''].join(',')); } }
        if (uniK === 'all' && v === 'asWritten') { for (const a of r.alerts) if (blockOf(a.t)) signals.push([blockOf(a.t), s, a.v === 'full' ? 'early warning (full)' : 'near ceiling (simple)', iso(a.t), a.lv, +a.dist.toFixed(3)].join(','));
          for (const b of r.brks) if (blockOf(b.t)) signals.push([blockOf(b.t), s, 'breakout', iso(b.t), b.lv, +b.vm.toFixed(2), b.spike ? 'spike +1 ATR' : 'no spike', b.spike3 ? '+3 ATR' : '', b.state].join(',')); }
      }
    }
    if (Object.keys(coverage).length % 10 === 0) console.log(`${Object.keys(coverage).length} coins done, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  // tables
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; }, pc = (a, b) => b ? +(a / b).toFixed(3) : null;
  const summary = {};
  for (const [k, A] of Object.entries(acc)) summary[k] = {
    scanner: { simple: { alerts: A.alerts.base, ledToSpike: pc(A.toSpike.base, A.alerts.base), spikesWarned: pc(A.warned.base, A.spikes), medianLeadH: med(A.lead.base) },
               full: { alerts: A.alerts.full, ledToSpike: pc(A.toSpike.full, A.alerts.full), spikesWarned: pc(A.warned.full, A.spikes), medianLeadH: med(A.lead.full) } },
    breakouts: A.brk, spikes: A.spikes, spikes3atr: A.spikes3, failedRetests: A.failed, extended: A.extended, skipped: A.skipped,
    trade: { plain: stats(A.plain), full: stats(A.full), plainDoubleSlippage: stats(A.plain2), fullDoubleSlippage: stats(A.full2), plainByBtcTrend: Object.fromEntries(Object.entries(A.byTrend).map(([t, rs]) => [t, stats(rs)])) } };
  fs.mkdirSync(OUT, { recursive: true });
  const doc = { about: 'Walk-forward backtest of the breakout-and-retest strategy, rules frozen 27 Nov 2026 (see engine/backtest.js). Paper trades only. Not financial advice.', ran: iso(Date.now()), source: host, blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, [a, b]]) => [k, [iso(a), iso(b)]])), rules: Object.assign({}, SETUPS.DEF, { noEntry: undefined }), versions: Object.keys(VERS), coins: Object.keys(coverage).length, failed, coverage, summary };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(doc, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'trades.csv'), 'version,block,coin,breakout_utc,level,entry_signal_utc,entry,stop,target,rr_to_resistance,setup,exit,exit_utc,net_r,net_r_double_slippage,costs_in_r,btc_trend,resolved\n' + trades.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'signals.csv'), 'block,coin,signal,time_utc,level,detail,spike,spike_3atr,retest\n' + signals.join('\n') + '\n');
  console.log(`done: ${doc.coins} coins, ${trades.length} trades, ${signals.length} signals, ${Math.round((Date.now() - t0) / 1000)} s; failed ${Object.keys(failed).length}`);
})().catch(e => { console.error(e); process.exit(1); });
