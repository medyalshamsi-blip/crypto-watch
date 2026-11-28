// Replay test for the Test tab and the new chart detections (backtest workflow, set "radars").
// 60 days of closed Binance 15m candles for the top coins (1H and 4H built from them). Point in time throughout.
// 1) Radars: after each hit, +5% or -5% first within 6 h (4H: 24 h) and the close after, against every bar of the same coins.
// 2) Chart patterns (1H, 4H): after a confirmed break, did the 80% target come before the stop within 48 bars?
//    Compared with the zero-drift chance for the same distances, stop / (target + stop).
// 3) Candle rejections at levels (1H): enter when the next bar takes out the rejection's extreme, stop beyond it,
//    target 2R within 24 bars; zero-drift chance 1/3.
// Read-only. Not financial advice.
const fs = require('fs');
const path = require('path');
const R2 = require('./radars2.js');
const PAT = require('./patterns.js');
const { ta } = require('./ta.js');

const OUT = path.join(__dirname, '..', 'data', 'backtest', 'radars');
const DAYS = 60, COINS = +(process.env.RT_COINS || 150), M15 = 9e5;
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(p) { let err; for (const h of HOSTS) { try { const r = await fetch(h + p, { signal: AbortSignal.timeout(20000) }); if (r.ok) return r.json(); err = new Error('HTTP ' + r.status); } catch (e) { err = e; } } throw err; }
const parse = a => { const d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }; for (const k of a) { d.t.push(+k[0]); d.o.push(+k[1]); d.h.push(+k[2]); d.l.push(+k[3]); d.c.push(+k[4]); d.v.push(+k[5]); d.tb.push(+k[9]); } return d; };
async function candles(sym) {
  const parts = []; let end = Date.now();
  const need = Math.ceil(DAYS * 96 / 1000);
  for (let k = 0; k < need; k++) { const a = parse(await get(`/api/v3/klines?symbol=${sym}&interval=15m&limit=1000&endTime=${end}`)); if (!a.t.length) break; parts.unshift(a); end = a.t[0] - 1; await sleep(40); }
  const d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }; for (const p of parts) for (const k in d) d[k].push(...p[k]);
  while (d.t.length && d.t[d.t.length - 1] + M15 > Date.now()) for (const k in d) d[k].pop();
  return d;
}
const z = () => ({ n: 0, up5: 0, dn5: 0, upFirst: 0, dnFirst: 0, closeUp: 0, ret: 0 });
const add = (b, oc) => { b.n++; if (oc.up5) b.up5++; if (oc.dn5) b.dn5++; if (oc.first === 1) b.upFirst++; if (oc.first === -1) b.dnFirst++; if (oc.ret > 0) b.closeUp++; b.ret += oc.ret; };
const fin = b => ({ n: b.n, up5: pc(b.up5, b.n), dn5: pc(b.dn5, b.n), upFirst: pc(b.upFirst, b.n), dnFirst: pc(b.dnFirst, b.n), closeUp: pc(b.closeUp, b.n), avgRetPct: b.n ? +(100 * b.ret / b.n).toFixed(3) : null });
const pc = (a, n) => n ? +(100 * a / n).toFixed(1) : null;

// first-touch trade: target or stop within `bars`, from entry at bar j's close (or at a trigger price on a later bar)
function trade(m, n, j, entry, stop, target, bars) {
  const up = target > entry;
  for (let i = j + 1; i <= Math.min(n - 1, j + bars); i++) {
    const hitS = up ? m.l[i] <= stop : m.h[i] >= stop, hitT = up ? m.h[i] >= target : m.l[i] <= target;
    if (hitS) return { win: 0, done: true };            // both in one bar: stop first
    if (hitT) return { win: 1, done: true };
  }
  return { win: null, done: j + bars <= n - 1 };
}

(async () => {
  const tk = await get('/api/v3/ticker/24hr'), now = Date.now();
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && +x.quoteVolume >= 2e6 && +x.closeTime > now - 3 * 3600e3 && !/^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR|EURI|XUSD|USD1|BFUSD|PAXG|WBTC|WBETH)USDT$/.test(x.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol) && Math.abs(+x.lastPrice - 1) > 0.02)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, COINS).map(x => x.symbol);
  const R = { sweep: {}, flow: {} }, base = { '15m': z(), '1H': z(), '4H': z() }, pats = {}, rej = { n: 0, win: 0, conf: 0, bull: { n: 0, win: 0 }, bear: { n: 0, win: 0 } };
  let coins = 0, failed = 0, pBars = 0;
  const bucket = (radar, key) => (R[radar][key] = R[radar][key] || z());
  for (const s of uni) {
    let d; try { d = await candles(s); } catch (e) { failed++; continue; }
    if (d.t.length < 2000) { failed++; continue; }
    coins++;
    const n = d.t.length, sc = R2.scan(d, n), tfs = { '15m': [d, n], '1H': [sc.h1, sc.h1.t.length], '4H': [sc.h4, sc.h4.t.length] };
    for (const [tf, [m, k]] of Object.entries(tfs)) { const step = tf === '15m' ? 4 : 1; for (let j = 60; j < k; j += step) { const oc = R2.outcome(m, k, j, tf); if (oc && oc.done) add(base[tf], oc); } }
    for (const [radar, list] of [['sweep', sc.sweep], ['flow', sc.flow]]) for (const h of list) {
      const [m, k] = tfs[h.tf], oc = R2.outcome(m, k, h.j, h.tf); if (!oc || !oc.done) continue;
      const side = h.side > 0 ? 'bull' : 'bear', band = h.score >= 5 ? '5+' : h.score >= 4 ? '4-4.5' : '3-3.5';
      for (const key of [`${side} all`, `${side} ${h.tf}`, `${side} score ${band}`, `${side} ${R2.KIND[h.kind] || h.kind}`]) add(bucket(radar, key), oc);
    }
    // patterns on 1H and 4H: read every 4th bar (1H) / every bar (4H), keep each confirmed break once
    for (const [tf, [m, k], step, bars] of [['1H', tfs['1H'], 1, 48], ['4H', tfs['4H'], 1, 30]]) {
      const seen = new Set();
      for (let e = 200; e <= k; e += step) {
        pBars++;
        for (const p of PAT.find(m, e)) {
          if (p.status === 'forming' || !p.brk || p.brk.i < e - step - 1) continue;      // only breaks that happened since the last read
          const key = p.type + ':' + p.brk.i; if (seen.has(key)) continue; seen.add(key);
          const t = trade(m, k, p.brk.i, p.entry, p.stop, p.target80, bars); if (!t.done || t.win == null) continue;
          const dist = Math.abs(p.target80 - p.entry), risk = Math.abs(p.entry - p.stop); if (!(risk > 0)) continue;
          const g = pats[`${tf} ${p.name}`] = pats[`${tf} ${p.name}`] || { n: 0, win: 0, chance: 0, volOk: 0, volOkWin: 0 };
          g.n++; g.win += t.win; g.chance += risk / (dist + risk); if (p.volOk) { g.volOk++; g.volOkWin += t.win; }
        }
      }
    }
    // candle rejections at levels on 1H (levels from the structure rules known at the time: areas and equal highs/lows first seen before the candle)
    { const [m, k] = tfs['1H'], cut = (w) => Object.fromEntries(Object.entries(m).map(([f, a]) => [f, a.slice(0, w)]));
      for (let w = 300; w + 1 < k; w += 24) {                       // levels known at bar w, used for the next 24 bars
        const Z = ta(cut(w)), lv = Z.sr.map(z0 => ({ lo: z0.lo, hi: z0.hi, what: 'area' })).concat(Z.eq.map(q => ({ lo: q.p, hi: q.p, what: 'equal' })));
        const end = Math.min(k, w + 24 + 2), mm = cut(end);
        for (const x of PAT.rejections(mm, end, lv, { look: end - w, intraday: true })) {
          if (x.i < w || x.i >= w + 24 || x.status !== 'confirmed') continue; rej.conf++;
          const entry = x.trigger, stop = x.stop, target = entry + 2 * (entry - stop); const t = trade(m, k, x.at, entry, stop, target, 24);
          if (!t.done || t.win == null) continue; rej.n++; rej.win += t.win; const sd = rej[x.side > 0 ? 'bull' : 'bear']; sd.n++; sd.win += t.win;
        }
      } }
    if (coins % 10 === 0) console.log(`${coins} coins…`);
  }
  const out = {
    about: 'Replay of the Test tab radars, chart patterns and candle rejections on 60 days of Binance 15m candles (1H, 4H built from them). Point in time. Outcome: +5% / -5% first within 6 h (4H: 24 h). Patterns: 80% target before stop within 48 bars (1H) / 30 bars (4H), against the zero-drift chance stop/(target+stop). Rejections: entry on the follow-through, target 2R within 24 bars, zero-drift chance 33%. Not financial advice.',
    ran: new Date(now).toISOString(), coins, failed, days: DAYS,
    base: Object.fromEntries(Object.entries(base).map(([k, b]) => [k, fin(b)])),
    radars: Object.fromEntries(Object.entries(R).map(([r, g]) => [r, Object.fromEntries(Object.entries(g).sort().map(([k, b]) => [k, fin(b)]))])),
    patterns: Object.fromEntries(Object.entries(pats).sort().map(([k, g]) => [k, { n: g.n, winPct: pc(g.win, g.n), chancePct: g.n ? +(100 * g.chance / g.n).toFixed(1) : null, onVolume: g.volOk, onVolumeWinPct: pc(g.volOkWin, g.volOk) }])),
    rejections: { confirmed: rej.conf, finished: rej.n, winPct: pc(rej.win, rej.n), chancePct: 33.3, bull: { n: rej.bull.n, winPct: pc(rej.bull.win, rej.bull.n) }, bear: { n: rej.bear.n, winPct: pc(rej.bear.win, rej.bear.n) } },
    reads: pBars
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
