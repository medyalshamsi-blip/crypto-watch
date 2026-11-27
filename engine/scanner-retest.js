// Retest of the daily playbook scanner: live rules (playbook.js) vs the book rebuild (playbook.next.js), walk-forward on daily Binance candles.
// Each coin is scanned on its last 400 closed daily bars as of each test day (every 7th day, so 7-day windows do not overlap within a coin);
// the call is scored on the close 7 days later. Calls on the same day across coins move together, so intervals are bootstrapped by day.
const fs = require('fs'), path = require('path');
const OLD = require('./playbook.js'), NEW = require('./playbook.next.js');
const OUT = path.join(__dirname, '..', 'data', 'backtest', 'scanner');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8'));
const DAY = 864e5, END = Date.parse('2026-11-27T00:00:00Z'), H = 7, STEP = 7, WIN = 400, WARM = 250;
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD|RLUSD|USDE|EURI|USDS|USDJ|XAUT)USDT$|^[A-Z0-9]+(UP|DOWN|BULL|BEAR)USDT$/;
const CRYPTO_B = new Set(['BNB', 'DGB', 'TRB', 'CKB', 'ARB', 'SHIB', 'BB', 'YB']);
const isStock = s => { const b = s.replace(/USDT$/, ''); return /B$/.test(b) && b.length >= 3 && !CRYPTO_B.has(b); };
const isStable = x => Math.abs(+x.lastPrice - 1) < 0.01 && +x.lowPrice > 0 && +x.highPrice / +x.lowPrice < 1.01;
let host = null;
async function get(p) { let err; for (let a = 0; a < 3; a++) for (const h of host ? [host, ...HOSTS.filter(x => x !== host)] : HOSTS) { try { const r = await fetch(h + p, { signal: AbortSignal.timeout(25000) }); if (r.status === 400) { const e = new Error('not on Binance spot'); e.final = true; throw e; } if (!r.ok) throw new Error(`HTTP ${r.status}`); host = h; return await r.json(); } catch (e) { if (e.final) throw e; err = e; } } throw err; }
const PERIODS = [['before May 2026', -Infinity, Date.parse('2026-05-01T00:00:00Z')], ['May-Aug 2026', Date.parse('2026-05-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z')], ['Sep-Nov 2026', Date.parse('2026-09-01T00:00:00Z'), END]];
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function score(rows, key) {          // hit rate of directional calls vs the base rate of the same days, bootstrapped by day
  const byDay = new Map(); for (const r of rows) { if (!byDay.has(r.t)) byDay.set(r.t, []); byDay.get(r.t).push(r); }
  const days = [...byDay.keys()];
  const stat = ds => { let bu = 0, bh = 0, be = 0, eh = 0, up = 0, n = 0, bR = 0, eR = 0; for (const d of ds) for (const r of byDay.get(d)) { n++; if (r.f > 0) up++; if (r[key] === 'Bullish') { bu++; if (r.f > 0) bh++; bR += r.f; } if (r[key] === 'Bearish') { be++; if (r.f < 0) eh++; eR += r.f; } }
    const base = up / n; return { n, base, bull: bu, bullHit: bu ? bh / bu : NaN, bullEdge: bu ? bh / bu - base : NaN, bullAvg: bu ? bR / bu : NaN, bear: be, bearHit: be ? eh / be : NaN, bearEdge: be ? eh / be - (1 - base) : NaN, bearAvg: be ? eR / be : NaN }; };
  const s = stat(days), R = rng(11), bb = [], eb = [];
  for (let k = 0; k < 1000; k++) { const ds = days.map(() => days[Math.floor(R() * days.length)]); const x = stat(ds); bb.push(x.bullEdge); eb.push(x.bearEdge); }
  const ci = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? [+b[Math.floor(b.length * .05)].toFixed(3), +b[Math.floor(b.length * .95)].toFixed(3)] : null; };
  const r3 = x => Number.isFinite(x) ? +x.toFixed(4) : null;
  return { days: days.length, calls: s.n, baseUp: r3(s.base), bullish: { n: s.bull, hit: r3(s.bullHit), edge: r3(s.bullEdge), edgeCI90: ci(bb), avg7d: r3(s.bullAvg) }, bearish: { n: s.bear, hit: r3(s.bearHit), edge: r3(s.bearEdge), edgeCI90: ci(eb), avg7d: r3(s.bearAvg) } };
}
(async () => {
  const t0 = Date.now(), wl = new Set([...COINS.focus, ...COINS.rest].map(c => c + 'USDT'));
  const tk = await get('/api/v3/ticker/24hr'), alive = x => +x.count > 0 && +x.closeTime > Date.now() - 3 * 3600e3;
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && !SKIP.test(x.symbol) && !isStable(x) && !isStock(x.symbol) && +x.quoteVolume >= 1e6 && alive(x)).sort((a, b) => b.quoteVolume - a.quoteVolume).map(x => x.symbol);
  const live = new Set(tk.filter(alive).map(x => x.symbol)), syms = [...new Set([...[...wl].filter(s => live.has(s)), ...uni])].slice(0, 200);
  const rows = [], failed = {}; let changed = 0;
  for (const s of syms) {
    let k; try { k = await get(`/api/v3/klines?symbol=${s}&interval=1d&endTime=${END - 1}&limit=1000`); } catch (e) { failed[s] = e.message; continue; }
    const d = { t: k.map(x => +x[0]), o: k.map(x => +x[1]), h: k.map(x => +x[2]), l: k.map(x => +x[3]), c: k.map(x => +x[4]), v: k.map(x => +x[5]) };
    if (d.t.length < WARM + H + 10) { failed[s] = `only ${d.t.length} days`; continue; }
    for (let i = WARM; i + H < d.t.length; i += STEP) {
      const a = Math.max(0, i + 1 - WIN), w = {}; for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) w[f] = d[f].slice(a, i + 1);
      let o, n; try { o = OLD.scan(w, s); n = NEW.scan(w, s); } catch (e) { continue; }
      const f = d.c[i + H] / d.c[i] - 1; if (o.verdict !== n.verdict) changed++;
      rows.push({ s, t: d.t[i], f, old: o.verdict, new: n.verdict, wl: wl.has(s) });
    }
  }
  const out = { about: 'Daily playbook scanner, live rules vs the book rebuild (27 Nov 2026): Bullish calls scored as right when the close 7 days later is higher, Bearish when lower. Edge = hit rate minus the share of all test days that went the same way. Not financial advice.', ran: new Date().toISOString(), coins: new Set(rows.map(r => r.s)).size, failed, rows: rows.length, changedCalls: changed, periods: {} };
  for (const [name, a, b] of [['all', -Infinity, Infinity], ...PERIODS]) {
    const R = rows.filter(r => r.t >= a && r.t < b); if (!R.length) continue;
    const ch = R.filter(r => r.old !== r.new);
    out.periods[name] = { old: score(R, 'old'), new: score(R, 'new'), changedOnly: { n: ch.length, old: score(ch, 'old'), new: score(ch, 'new') } };
  }
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'calls.csv'), 'coin,day_utc,old,new,fwd_7d,watchlist\n' + rows.map(r => [r.s, new Date(r.t).toISOString().slice(0, 10), r.old, r.new, r.f.toFixed(4), r.wl ? 1 : 0].join(',')).join('\n') + '\n');
  console.log(`done: ${out.coins} coins, ${rows.length} calls, ${changed} changed, ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(e); process.exit(1); });
