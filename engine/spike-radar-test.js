// Replay of the "crypto spike radar" prompt (27 Nov 2026), run once by hand on GitHub Actions. Paper only. Not financial advice.
// Rules frozen before the run:
//   spike     = a 15m close at least 5% above the close one hour (4 candles) earlier; at most one per coin per 24 h
//   Watch     = close below and within 1 ATR14 (4H) of the nearest unbroken confirmed 4H swing high (last 10 days), and cumulative
//               volume since 00:00 UTC >= 1.3x the same time of day over the prior 20 days; one alert per level per 24 h
//   Moving    = 15m close >= +0.75% vs the previous close, volume >= 2x the average of the previous 20 candles; one per coin per hour
//   Confirmed = Moving + close above the highest high of the previous 16 candles + above session VWAP (00:00 UTC) + taker buys >= 55%
//   Fade      = after a Confirmed breakout (level = that 16-candle high), a completed UTC-hour 1H candle closing below the level and VWAP
//   Trades    = retest (first 15m touch of the level closes back above level and VWAP), 1H hold (first full 1H candle after the
//               breakout closes above level and VWAP), 1H hold with the stop under the 16-candle base, retest with a fade exit;
//               next open entry, >= 2R room to resistance after costs, +2R net target, 24 h exit, stop first, one trade at a time
//   costs 0.10% fee + 0.05% slippage per side; blocks: unseen 1 May - 31 Aug 2026, build 1 Sep - 26 Nov 2026
const fs = require('fs'), path = require('path');
const R = require('./radar.js'), SU = require('./setups.js');
const OUT = path.join(__dirname, '..', 'data', 'backtest', 'spike-radar');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8'));
const NAMED = ['ETHFI', 'ENA', 'FET', 'ZEC', 'ORDI', 'MUBARAK', 'INIT', 'ORCA', 'KERNEL'].map(x => x + 'USDT');
const M15 = 900e3, H1 = 3600e3, H4 = 4 * H1, DAY = 864e5, COST = 0.0015, COST2 = 0.002;
const FETCH_FROM = Date.parse('2026-04-01T00:00:00Z'), END = Date.parse('2026-11-27T00:00:00Z');
const BLOCKS = { unseen: [Date.parse('2026-05-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z')], build: [Date.parse('2026-09-01T00:00:00Z'), END] };
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD|RLUSD|USDE|EURI|USDS|USDJ|XAUT)USDT$|^[A-Z0-9]+(UP|DOWN|BULL|BEAR)USDT$/;
const CRYPTO_B = new Set(['BNB', 'DGB', 'TRB', 'CKB', 'ARB', 'SHIB', 'BB', 'YB']);
const isStock = s => { const b = s.replace(/USDT$/, ''); return /B$/.test(b) && b.length >= 3 && !CRYPTO_B.has(b); };
const isStable = x => Math.abs(+x.lastPrice - 1) < 0.01 && +x.lowPrice > 0 && +x.highPrice / +x.lowPrice < 1.01;
let host = null;
async function get(p) {
  let err;
  for (let a = 0; a < 3; a++) for (const h of host ? [host, ...HOSTS.filter(x => x !== host)] : HOSTS) {
    try { const r = await fetch(h + p, { signal: AbortSignal.timeout(25000) }); if (r.status === 400) { const e = new Error('not on Binance spot'); e.final = true; throw e; } if (r.status === 429 || r.status === 418) { await new Promise(z => setTimeout(z, 5000)); throw new Error('rate limit'); } if (!r.ok) throw new Error(`HTTP ${r.status}`); host = h; return await r.json(); }
    catch (e) { if (e.final) throw e; err = e; }
  }
  throw err;
}
async function candles(sym) {
  const d = { t: [], o: [], h: [], l: [], c: [], v: [], q: [], tb: [] }; let s = FETCH_FROM;
  while (s < END) { const k = await get(`/api/v3/klines?symbol=${sym}&interval=15m&startTime=${s}&endTime=${END - 1}&limit=1000`); if (!k.length) break;
    for (const x of k) { d.t.push(+x[0]); d.o.push(+x[1]); d.h.push(+x[2]); d.l.push(+x[3]); d.c.push(+x[4]); d.v.push(+x[5]); d.q.push(+x[7]); d.tb.push(+x[9]); }
    s = +k[k.length - 1][0] + M15; if (k.length < 1000) break; }
  return d;
}
const blockOf = t => Object.keys(BLOCKS).find(k => t >= BLOCKS[k][0] && t < BLOCKS[k][1]) || null;
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function stats(rs) {
  const n = rs.length; if (!n) return { n: 0 };
  const mean = rs.reduce((a, x) => a + x, 0) / n, Rr = rng(42), bs = [];
  for (let k = 0; k < 2000; k++) { let s = 0; for (let i = 0; i < n; i++) s += rs[Math.floor(Rr() * n)]; bs.push(s / n); }
  bs.sort((a, b) => a - b); let cum = 0, pk = 0, dd = 0; for (const x of rs) { cum += x; pk = Math.max(pk, cum); dd = Math.max(dd, pk - cum); }
  return { n, avgR: +mean.toFixed(3), ci90: [+bs[100].toFixed(3), +bs[1899].toFixed(3)], totalR: +cum.toFixed(2), maxDrawdownR: +dd.toFixed(2), totalWithoutBestR: +(cum - Math.max(...rs)).toFixed(2), win: +(rs.filter(x => x > 0).length / n).toFixed(3), verdict: n < 30 ? 'inconclusive (under 30 trades)' : bs[100] > 0 ? 'positive' : bs[1899] < 0 ? 'negative' : 'inconclusive (interval includes zero)' };
}
const mean = a => a.length ? +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(5) : null;
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const share = (a, f) => a.length ? +(a.filter(f).length / a.length).toFixed(3) : null;

function analyse(s, m, btc1h) {
  const n = m.c.length, c = m.c, o = m.o, h = m.h, l = m.l, v = m.v;
  const A15 = R.atr(m), VW = SU.vwapAt(m, n), RV = SU.rvolAt(m, n, SU.DEF), d4 = SU.to4H(m, n), I = SU.ind4(d4, SU.DEF);
  const hourClose = k => (m.t[k] + M15) % H1 === 0;
  // spikes
  const spikes = []; let nextOK = 0;
  for (let k = 4; k < n; k++) if (k >= nextOK && c[k] / c[k - 4] >= 1.05) { spikes.push(k); nextOK = k + 96; }
  // Watch alerts and 4H context per bar
  const watch = [], broken = new Set(), lastLv = new Map(), K4 = new Int32Array(n); let K = 0;
  for (let j = 0; j < n; j++) {
    const T = m.t[j] + M15; while (K < d4.t.length && d4.t[K] + H4 <= T) K++; K4[j] = K;
    if (K < 30) continue;
    for (const p of I.ph) if (p.conf < K && c[j] > p.lv) broken.add(p.k);
    let near = null; for (const p of I.ph) if (p.conf < K && p.k >= K - 60 && !broken.has(p.k) && p.lv > c[j] && (near === null || p.lv < near)) near = p.lv;
    const atr4 = I.A[K - 1];
    if (near !== null && near - c[j] <= atr4 && RV.rv[j] >= 1.3) { const lj = lastLv.get(near); if (lj === undefined || j - lj >= 96) { watch.push({ j, lv: near }); lastLv.set(near, j); } }
  }
  // Moving and Confirmed alerts
  const moving = [], conf = []; let lastM = -99, lastC = -99;
  for (let j = 21; j < n; j++) {
    let av = 0; for (let q = j - 20; q < j; q++) av += v[q]; av /= 20;
    const r = c[j] / c[j - 1] - 1; if (!(r >= 0.0075 && av > 0 && v[j] >= 2 * av)) continue;
    let hh = -Infinity; for (let q = j - 16; q < j; q++) hh = Math.max(hh, h[q]);
    const buy = v[j] > 0 ? m.tb[j] / v[j] : NaN, ok = c[j] > hh && c[j] > VW[j] && buy >= 0.55;
    if (j - lastM >= 4) { moving.push({ j, r, vm: v[j] / av, buy }); lastM = j; }
    if (ok && j - lastC >= 4) { let base = Infinity; for (let q = j - 16; q < j; q++) base = Math.min(base, l[q]); conf.push({ j, lv: hh, base, r, vm: v[j] / av, buy, btc: btc1h(m.t[j]) }); lastC = j; }
  }
  // first resistance known at entry: nearest confirmed 4H swing high above, else the highest 4H high before the breakout
  const resist = (px, Kq, tB) => { let best = null; for (const p of I.ph) if (p.conf < Kq && p.lv > px && (best === null || p.lv < best)) best = p.lv; if (best !== null) return best; let mx = -Infinity; for (let k = 0; k < Kq && d4.t[k] + H4 <= tB; k++) mx = Math.max(mx, d4.h[k]); return mx > px ? mx : null; };
  function sim(q, stop, L, fadeExit) {           // signal on bar q, entry at the open of q + 1
    if (q + 1 >= n) return { skip: 'no next candle' };
    const entry = o[q + 1], Eb = entry * (1 + COST), risk = Eb - stop * (1 - COST);
    if (!(risk > 0)) return { skip: 'no risk' };
    const res = resist(entry, K4[q], m.t[q] + M15), rr = res === null ? Infinity : (res * (1 - COST) - Eb) / risk;
    if (rr < 2) return { skip: 'under 2R to resistance' };
    const tgt = (Eb + 2 * risk) / (1 - COST); let out = null;
    for (let k = q + 1; k < n && k <= q + 96; k++) {
      if (l[k] <= stop) { out = { why: 'stop', k, px: Math.min(stop, o[k]) }; break; }
      if (h[k] >= tgt) { out = { why: 'target', k, px: Math.max(tgt, o[k]) }; break; }
      if (fadeExit && hourClose(k) && c[k] < L && c[k] < VW[k] && k + 1 < n) { out = { why: 'fade exit', k: k + 1, px: o[k + 1] }; break; }
    }
    if (!out) { if (q + 1 + 96 < n) out = { why: 'time', k: q + 1 + 96, px: o[q + 1 + 96] }; else return { skip: 'open at the end' }; }
    const r = (out.px * (1 - COST) - Eb) / risk, E2 = entry * (1 + COST2), r2 = (out.px * (1 - COST2) - E2) / (E2 - stop * (1 - COST2));
    return { entry, stop, tgt, rr, risk, costR: (entry + stop) * COST / risk, stopPct: (entry - stop) / entry, exit: out.why, exitT: m.t[out.k] + (out.why === 'time' || out.why === 'fade exit' ? 0 : M15), r, r2, end: out.k };
  }
  const trades = [], fades = [], holds = [], busy = { retest: -1, hold1h: -1, hold1hBase: -1, retestFade: -1 };
  for (const b of conf) {
    const j0 = b.j, L = b.lv, end = Math.min(n - 1, j0 + 96);
    // first full UTC-hour candle after the breakout: hold or fade
    let e = -1; for (let k = j0 + 4; k <= end; k++) if (hourClose(k)) { e = k; break; }
    let fadeAt = -1; for (let k = j0 + 1; k <= end; k++) if (hourClose(k) && c[k] < L && c[k] < VW[k]) { fadeAt = k; break; }
    const fwd = (k, bars) => k + bars < n && k + 1 < n ? c[k + bars] / o[k + 1] - 1 : null;
    if (fadeAt >= 0) fades.push({ s, t: m.t[fadeAt] + M15, f4: fwd(fadeAt, 16), f24: fwd(fadeAt, 96) });
    const held = e >= 0 && c[e] > L && c[e] > VW[e];
    if (e >= 0) holds.push({ s, t: m.t[e] + M15, held, f4: fwd(e, 16), f24: fwd(e, 96) });
    b.after = { f1: j0 + 4 < n ? c[j0 + 4] / o[j0 + 1] - 1 : null, f4: j0 + 16 < n ? c[j0 + 16] / o[j0 + 1] - 1 : null, held, fade: fadeAt >= 0 };
    // retest
    let rq = -1, rfail = false; for (let q = j0 + 1; q <= end; q++) if (l[q] <= L + 0.1 * A15[q]) { if (c[q] > L && c[q] > VW[q]) rq = q; else rfail = true; break; }
    const add = (variant, q, stop, fadeExit) => { if (q < 0) return; if (q < busy[variant]) { trades.push({ s, variant, t: m.t[q] + M15, skip: 'a trade was already open' }); return; } const x = sim(q, stop, L, fadeExit); trades.push(Object.assign({ s, variant, t: m.t[q] + M15, brkT: m.t[j0] + M15, L }, x)); if (!x.skip) busy[variant] = x.end; };
    if (rq >= 0) { add('retest', rq, l[rq] - 0.25 * A15[rq], false); add('retestFade', rq, l[rq] - 0.25 * A15[rq], true); }
    b.retest = rq >= 0 ? 'entry' : rfail ? 'failed' : 'none';
    if (held) { let lo = Infinity; for (let q = e - 3; q <= e; q++) lo = Math.min(lo, l[q]); add('hold1h', e, lo - 0.25 * A15[e], false); add('hold1hBase', e, Math.min(b.base, lo) - 0.25 * A15[e], false); }
  }
  // chance at random: share of bars (every 4th) followed by a spike within 2 h and within 24 h
  const sp = new Set(spikes), within = (j, w) => { for (let k = j + 1; k <= j + w && k < n; k++) if (sp.has(k)) return true; return false; };
  const base = []; for (let j = 400; j < n - 96; j += 4) base.push({ t: m.t[j] + M15, f2: within(j, 8), f24: within(j, 96), d24: c[j + 96] / c[j] - 1 });
  return { n, spikes: spikes.map(k => ({ k, t: m.t[k] + M15 })), watch: watch.map(a => ({ j: a.j, t: m.t[a.j] + M15 })), moving: moving.map(a => Object.assign(a, { t: m.t[a.j] + M15 })), conf: conf.map(a => Object.assign(a, { t: m.t[a.j] + M15 })), trades, fades, holds, base };
}
function score(alerts, spikes, back, fwd) {     // alert -> spike completion within `fwd` candles; spike caught by an alert up to `back` candles earlier
  const caught = [], hits = alerts.filter(a => spikes.some(s => s.k > a.j && s.k <= a.j + fwd));
  for (const s of spikes) { const first = alerts.find(a => a.j >= s.k - back && a.j < s.k); if (first) caught.push((s.k - first.j) * 15); }
  return { alerts: alerts.length, followedBySpike: hits.length, falseAlerts: alerts.length - hits.length, spikes: spikes.length, caught: caught.length, leadsMin: caught };
}
(async () => {
  const t0 = Date.now(), wl = new Set([...COINS.focus, ...COINS.rest].map(c => c + 'USDT'));
  const tk = await get('/api/v3/ticker/24hr'), alive = x => +x.count > 0 && +x.closeTime > Date.now() - 3 * 3600e3;
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && !SKIP.test(x.symbol) && !isStable(x) && !isStock(x.symbol) && +x.quoteVolume >= 1e6 && alive(x)).sort((a, b) => b.quoteVolume - a.quoteVolume).map(x => x.symbol);
  const live = new Set(tk.filter(alive).map(x => x.symbol)), syms = [...new Set([...NAMED.filter(s => live.has(s)), ...[...wl].filter(s => live.has(s)), ...uni])].slice(0, 200);
  const btc = await candles('BTCUSDT'), bmap = new Map(); for (let i = 4; i < btc.t.length; i++) bmap.set(btc.t[i], btc.c[i] / btc.c[i - 4] - 1);
  const btc1h = t => bmap.has(t) ? bmap.get(t) : null;
  const acc = {}, coverage = {}, failed = {}, tradeRows = [], perCoin = {};
  const slot = (blk, u) => { const k = `${blk}|${u}`; return acc[k] = acc[k] || { spikes: 0, watch: { a: 0, hit: 0, caught: 0, lead: [] }, moving: { a: 0, hit: 0, caught: 0, lead: [] }, conf: { a: 0, hit: 0, caught: 0, lead: [] }, base2: [], base24: [], drift24: [], confAfter: [], fades: [], holds: [], trades: {}, skips: {} }; };
  for (const s of syms) {
    let m; try { m = await candles(s); } catch (e) { failed[s] = e.message; continue; }
    if (m.t.length < 2000) { failed[s] = `only ${m.t.length} candles`; continue; }
    coverage[s] = { from: iso(m.t[0]), candles: m.t.length, named: NAMED.includes(s) || undefined, watchlist: wl.has(s) || undefined };
    const x = analyse(s, m, btc1h), us = NAMED.includes(s) ? ['all', 'named'] : ['all'];
    const pc = perCoin[s] = NAMED.includes(s) ? { spikes: 0, conf: 0, confFollowed: 0, fadeShare: null, heldShare: null, trades: {} } : null;
    for (const blk of Object.keys(BLOCKS)) {
      const inB = a => blockOf(a.t) === blk, sp = x.spikes.filter(inB);
      const W = score(x.watch.filter(inB), sp, 96, 96), Mv = score(x.moving.filter(inB), sp, 8, 8), Cf = score(x.conf.filter(inB), sp, 8, 8);
      for (const u of us) {
        const A = slot(blk, u); A.spikes += sp.length;
        for (const [k, z] of [['watch', W], ['moving', Mv], ['conf', Cf]]) { A[k].a += z.alerts; A[k].hit += z.followedBySpike; A[k].caught += z.caught; A[k].lead.push(...z.leadsMin); }
        for (const b of x.base.filter(inB)) { A.base2.push(b.f2); A.base24.push(b.f24); A.drift24.push(b.d24); }
        for (const b of x.conf.filter(inB)) A.confAfter.push({ f1: b.after.f1, f4: b.after.f4, btcUp: b.btc !== null && b.btc >= 0.0075, held: b.after.held, fade: b.after.fade, retest: b.retest });
        A.fades.push(...x.fades.filter(inB)); A.holds.push(...x.holds.filter(inB));
        for (const t of x.trades.filter(inB)) { if (t.skip) { A.skips[t.variant + ': ' + t.skip] = (A.skips[t.variant + ': ' + t.skip] || 0) + 1; continue; } (A.trades[t.variant] = A.trades[t.variant] || []).push(t); }
      }
      if (pc) { pc.spikes += sp.length; pc.conf += Cf.alerts; pc.confFollowed += Cf.followedBySpike; }
    }
    for (const t of x.trades) if (!t.skip && blockOf(t.t)) { tradeRows.push([t.variant, blockOf(t.t), s, iso(t.brkT), +t.L.toPrecision(6), iso(t.t), t.entry, +t.stop.toPrecision(6), +t.tgt.toPrecision(6), Number.isFinite(t.rr) ? +t.rr.toFixed(2) : 'clear', +(t.stopPct * 100).toFixed(2), t.exit, iso(t.exitT), +t.r.toFixed(3), +t.r2.toFixed(3), +t.costR.toFixed(3)].join(',')); if (pc) (pc.trades[t.variant] = pc.trades[t.variant] || []).push(+t.r.toFixed(3)); }
    if (pc) { const hs = x.holds.filter(h => blockOf(h.t)), fs_ = x.conf.filter(b => blockOf(b.t)); pc.heldShare = share(hs, h => h.held); pc.fadeShare = share(fs_, b => b.after.fade); pc.confirmedBreakouts = fs_.length; for (const k in pc.trades) pc.trades[k] = { n: pc.trades[k].length, avgR: mean(pc.trades[k]) }; }
    if (Object.keys(coverage).length % 10 === 0) console.log(`${Object.keys(coverage).length} coins, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const summary = {};
  for (const [k, A] of Object.entries(acc)) {
    const al = z => ({ alerts: z.a, followedBySpike: z.a ? +(z.hit / z.a).toFixed(3) : null, falseAlerts: z.a - z.hit, spikesCaught: A.spikes ? +(z.caught / A.spikes).toFixed(3) : null, medianLeadMin: med(z.lead) });
    const ca = A.confAfter, f = (a, key) => mean(a.map(x => x[key]).filter(x => x !== null));
    summary[k] = {
      spikes: A.spikes,
      chanceAtRandom: { spikeWithin2h: share(A.base2, x => x), spikeWithin24h: share(A.base24, x => x), avg24hReturn: mean(A.drift24) },
      watch: al(A.watch), moving: al(A.moving), confirmed: al(A.conf),
      afterConfirmed: { n: ca.length, avgNext1h: f(ca, 'f1'), avgNext4h: f(ca, 'f4'), next1hUp: share(ca.filter(x => x.f1 !== null), x => x.f1 > 0),
        btcUp: { n: ca.filter(x => x.btcUp).length, avgNext1h: f(ca.filter(x => x.btcUp), 'f1'), avgNext4h: f(ca.filter(x => x.btcUp), 'f4') },
        btcNotUp: { n: ca.filter(x => !x.btcUp).length, avgNext1h: f(ca.filter(x => !x.btcUp), 'f1'), avgNext4h: f(ca.filter(x => !x.btcUp), 'f4') },
        firstRetest: { entry: share(ca, x => x.retest === 'entry'), failed: share(ca, x => x.retest === 'failed'), none: share(ca, x => x.retest === 'none') }, fadeWithin24h: share(ca, x => x.fade) },
      firstHourAfterBreakout: { held: { n: A.holds.filter(x => x.held).length, avg4h: f(A.holds.filter(x => x.held), 'f4'), avg24h: f(A.holds.filter(x => x.held), 'f24') }, notHeld: { n: A.holds.filter(x => !x.held).length, avg4h: f(A.holds.filter(x => !x.held), 'f4'), avg24h: f(A.holds.filter(x => !x.held), 'f24') } },
      fadeSignal: { n: A.fades.length, avg4h: f(A.fades, 'f4'), avg24h: f(A.fades, 'f24'), lowerAfter24h: share(A.fades.filter(x => x.f24 !== null), x => x.f24 < 0) },
      trades: Object.fromEntries(Object.entries(A.trades).map(([v, ts]) => [v, Object.assign(stats(ts.map(t => t.r)), { doubleSlippage: stats(ts.map(t => t.r2)).avgR, exits: ts.reduce((o, t) => (o[t.exit] = (o[t.exit] || 0) + 1, o), {}), medianStopPct: +(med(ts.map(t => t.stopPct)) * 100).toFixed(2), medianCostR: +med(ts.map(t => t.costR)).toFixed(3) })])),
      skipped: A.skips,
    };
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ about: 'Replay of the crypto spike radar prompt, rules frozen 27 Nov 2026 (see engine/spike-radar-test.js). Paper only. Not financial advice.', ran: iso(Date.now()), source: host, blocks: Object.fromEntries(Object.entries(BLOCKS).map(([k, [a, b]]) => [k, [iso(a), iso(b)]])), coins: Object.keys(coverage).length, named: NAMED, failed, coverage, summary, perCoin: Object.fromEntries(Object.entries(perCoin).filter(([, v]) => v)) }, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'trades.csv'), 'variant,block,coin,breakout_utc,level,signal_utc,entry,stop,target,rr_to_resistance,stop_pct,exit,exit_utc,net_r,net_r_double_slippage,costs_in_r\n' + tradeRows.join('\n') + '\n');
  console.log(`done: ${Object.keys(coverage).length} coins, ${tradeRows.length} trades, ${Math.round((Date.now() - t0) / 1000)} s; failed ${Object.keys(failed).length}`);
})().catch(e => { console.error(e); process.exit(1); });
