'use strict';
// Replay of the 15-minute volume-spike radar on Binance USDT spot history. Paper only. Not financial advice.
//   rules and thresholds:  engine/spike-radar2.config.json   (change, push, the GitHub job reruns on the cached candles)
//   data window and coins: engine/spike-radar2.data.json     (change only to download different history)
//   results:               data/backtest/spike-radar2/{report.md, summary.json, events-*.csv}
// Only data available at the close of each event candle is used (see spike-radar2.js). Binance klines: x[7] quote volume, x[10] taker-buy QUOTE volume.
const fs = require('fs'), path = require('path');
const X = require('./spike-radar2.js');
const { M15, DAY, LABELS } = X;
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'spike-radar2.config.json'), 'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'spike-radar2.data.json'), 'utf8'));
const OUT = process.env.SR2_OUT || path.join(__dirname, '..', 'data', 'backtest', 'spike-radar2'), CACHE = process.env.SR2_CACHE || path.join(__dirname, '..', '.cache', 'klines');
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const SKIP = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|AEUR|USD1|XUSD|PAXG|WBTC|WBETH|BFUSD|RLUSD|USDE|EURI|USDS|USDJ|XAUT)USDT$|^[A-Z0-9]+(UP|DOWN|BULL|BEAR)USDT$/;
const CRYPTO_B = new Set(['BNB', 'DGB', 'TRB', 'CKB', 'ARB', 'SHIB', 'BB', 'YB']);
const isStock = s => { const b = s.replace(/USDT$/, ''); return /B$/.test(b) && b.length >= 3 && !CRYPTO_B.has(b); };
const isStable = x => Math.abs(+x.lastPrice - 1) < 0.01 && +x.lowPrice > 0 && +x.highPrice / +x.lowPrice < 1.01;
const NAMED = DATA.coins.named.map(x => x + 'USDT');
const FROM = Date.parse(DATA.fetchFrom), END = Date.parse(DATA.end);
const T0 = Math.floor(FROM / DAY) * DAY, N = Math.ceil((END - T0) / M15);
const A0 = Math.max(0, Math.round((Date.parse(CFG.period.analysisFrom) - T0) / M15)), SPLIT = Math.round((Date.parse(CFG.period.split) - T0) / M15);
const OUTN = ['O1', 'O2', 'O3', 'N1', 'N2', 'N3', 'D1', 'D2', 'D3'];
const OUTTXT = { O1: 'next 15m close > +5% from alert close', O2: 'next candle high > +5% from alert close', O3: 'any of next 4 closes > +5% from alert close',
  N1: 'as O1 but from the next open', N2: 'as O2 but from the next open', N3: 'as O3 but from the next open', D1: 'mirror of O1 (close < -5%)', D2: 'mirror of O2 (low < -5%)', D3: 'mirror of O3 (any close < -5%)' };

// ---------------------------------------------------------------- data
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
  const d = { t: [], o: [], h: [], l: [], c: [], q: [], tq: [] }; let s = FROM;
  while (s < END) {
    const k = await get(`/api/v3/klines?symbol=${sym}&interval=15m&startTime=${s}&endTime=${END - 1}&limit=1000`); if (!k.length) break;
    for (const x of k) { d.t.push(+x[0]); d.o.push(+x[1]); d.h.push(+x[2]); d.l.push(+x[3]); d.c.push(+x[4]); d.q.push(+x[7]); d.tq.push(+x[10]); }
    s = +k[k.length - 1][0] + M15; if (k.length < 1000) break;
  }
  return d;
}
const KEYS = ['t', 'o', 'h', 'l', 'c', 'q', 'tq'];
function saveCoin(sym, d) { const n = d.t.length, a = new Float64Array(1 + 7 * n); a[0] = n; KEYS.forEach((k, j) => a.set(d[k], 1 + j * n)); fs.writeFileSync(path.join(CACHE, sym + '.bin'), Buffer.from(a.buffer)); }
function loadCoin(sym) { const b = fs.readFileSync(path.join(CACHE, sym + '.bin')), a = new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), n = a[0], d = {}; KEYS.forEach((k, j) => d[k] = a.subarray(1 + j * n, 1 + (j + 1) * n)); return d; }
async function loadAll() {
  fs.mkdirSync(CACHE, { recursive: true });
  const meta = { fetchFrom: DATA.fetchFrom, end: DATA.end, coins: DATA.coins, cacheVersion: DATA.cacheVersion || 0, kline: 'x[10] taker-buy quote, v2' }, mf = path.join(CACHE, 'meta.json');
  if (fs.existsSync(mf)) { try { const m = JSON.parse(fs.readFileSync(mf, 'utf8')); if (JSON.stringify(m.meta) === JSON.stringify(meta) && m.syms.every(s => fs.existsSync(path.join(CACHE, s + '.bin')))) { console.log(`cache hit: ${m.syms.length} coins`); return { syms: m.syms, failed: m.failed || {}, data: new Map(m.syms.map(s => [s, loadCoin(s)])), cached: true }; } } catch (e) { /* refetch */ } }
  const COINS = JSON.parse(fs.readFileSync(path.join(__dirname, 'coins.json'), 'utf8')), wl = new Set([...COINS.focus, ...COINS.rest].map(c => c + 'USDT'));
  const tk = await get('/api/v3/ticker/24hr'), alive = x => +x.count > 0 && +x.closeTime > Date.now() - 3 * 3600e3;
  const uni = tk.filter(x => x.symbol.endsWith('USDT') && !SKIP.test(x.symbol) && !isStable(x) && !isStock(x.symbol) && +x.quoteVolume >= DATA.coins.universeMinQuoteVolumeUSDT && alive(x)).sort((a, b) => b.quoteVolume - a.quoteVolume).map(x => x.symbol);
  const live = new Set(tk.filter(alive).map(x => x.symbol));
  const want = [...new Set([...NAMED.filter(s => live.has(s)), ...[...wl].filter(s => live.has(s)), ...uni])].slice(0, DATA.coins.maxCoins);
  const missing = NAMED.filter(s => !want.includes(s)); const failed = {}; for (const s of missing) failed[s] = 'not live on Binance spot at download time';
  const data = new Map(), syms = []; let next = 0;
  async function worker() { while (next < want.length) { const s = want[next++]; try { const d = await candles(s); if (d.t.length < 2000) { failed[s] = `only ${d.t.length} candles`; continue; } saveCoin(s, d); data.set(s, d); syms.push(s); } catch (e) { failed[s] = e.message; } } }
  await Promise.all([1, 2, 3, 4].map(worker));
  syms.sort((a, b) => want.indexOf(a) - want.indexOf(b));
  fs.writeFileSync(mf, JSON.stringify({ meta, syms, failed }));
  return { syms, failed, data, cached: false };
}

// ---------------------------------------------------------------- statistics
function wilson(h, n) { if (!n) return [null, null]; const z = 1.96, p = h / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; }
const pc = (x, d = 1) => x === null || x === undefined || Number.isNaN(x) ? '-' : (100 * x).toFixed(d) + '%';
const num = (x, d = 2) => x === null || x === undefined || Number.isNaN(x) ? '-' : x.toFixed(d);
const berlin = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const bt = t => berlin.format(new Date(t)).replace(',', '');
const iso = t => new Date(t).toISOString().replace(':00.000Z', 'Z');
function merge(a, b) { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], b[k]) : b[k]; return o; }

// score a group of events against the control (any candle of the same coin and session label)
function score(evs, ctrl, js) {
  const r = { n: evs.length };
  for (const j of js) {
    let obs = 0, hit = 0, pend = 0, ex = 0;
    for (const e of evs) { const v = e.out[j]; if (v < 0) { pend++; continue; } obs++; hit += v; const c = ctrl.get(e.sym)[e.lab]; ex += c.obs[j] ? c.hit[j] / c.obs[j] : 0; }
    const rate = obs ? hit / obs : null, expected = obs ? ex / obs : null, ci = wilson(hit, obs);
    r[OUTN[j]] = { obs, hit, pend, rate, lo: ci[0], hi: ci[1], expected, lift: rate !== null && expected > 0 ? rate / expected : null };
  }
  return r;
}
const compact = s => { const o = { n: s.n }; for (const k of OUTN) if (s[k]) o[k] = { obs: s[k].obs, hit: s[k].hit, pend: s[k].pend, rate: s[k].rate === null ? null : +s[k].rate.toFixed(5), expected: s[k].expected === null ? null : +s[k].expected.toFixed(5), lift: s[k].lift === null ? null : +s[k].lift.toFixed(2) }; return o; };
const PRIM = [0, 1, 2], ALLJ = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// ---------------------------------------------------------------- one variant
function runVariant(v, grid, data, syms) {
  const rules = merge(CFG.rules, v.rules || {}), cfg = Object.assign({}, CFG, { rules }), ctrl = new Map(), events = [], cov = {};
  for (const s of syms) {
    const m = data.get(s), r = X.analyseCoin(s, m, grid, cfg, A0, N); ctrl.set(s, r.rates); cov[s] = r.cov;
    let ev = r.events;
    if (v.dedupeCandles) { const last = new Map(), keptP = new Set(); ev = ev.filter(e => { if (e.stage === 'Watch' || e.stage === 'Priority') { const k = e.stage, l = last.get(k); if (l !== undefined && e.i - l <= v.dedupeCandles) return false; last.set(k, e.i); if (k === 'Priority') keptP.add(e.i); return true; } return keptP.has(e.pi); }); }
    const pn = new Map(), useB = rules.h1Rule === 'beforeOpen';
    for (const e of ev) if (e.stage === 'Priority') { e.notif = !!(useB ? e.notifiedB : e.notified); if (v.excludeLateFromNotification && e.late) e.notif = false; pn.set(e.i, e.notif); }
    for (const e of ev) if (e.pi !== undefined) e.pNotif = !!pn.get(e.pi);
    for (const e of ev) events.push(e);
  }
  return { rules, events, ctrl, cov };
}
const isNot = e => e.stage === 'Priority' && e.notif;
const STAGES = [
  ['Watch', e => e.stage === 'Watch'], ['Watch, not Late spike', e => e.stage === 'Watch' && !e.late], ['Watch, Late spike', e => e.stage === 'Watch' && e.late],
  ['Priority', e => e.stage === 'Priority'], ['Priority on the Watch candle', e => e.stage === 'Priority' && e.same], ['Priority on a later close', e => e.stage === 'Priority' && !e.same],
  ['Notification', isNot], ['Same candle but 1H filter failed', e => e.stage === 'Priority' && e.same && !e.notif],
  ['Retest', e => e.stage === 'Retest'], ['Fade', e => e.stage === 'Fade'], ['Retest after a Notification', e => e.stage === 'Retest' && e.pNotif], ['Fade after a Notification', e => e.stage === 'Fade' && e.pNotif]
];
function stageTable(evs, ctrl, js) { const o = {}; for (const [name, f] of STAGES) o[name] = score(evs.filter(f), ctrl, js); return o; }
function rank(evs, syms) { const c = new Map(syms.map(s => [s, 0])); for (const e of evs) if (e.stage === 'Watch') c.set(e.sym, c.get(e.sym) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1]); }
function summariseSet(res, set, extra) {
  const inSet = new Set(set), evs = res.events.filter(e => inSet.has(e.sym)), rk = rank(evs, set), out = { coins: set.length, watchCountsTop: rk.slice(0, 8).map(x => [x[0].replace('USDT', ''), x[1]]) };
  out.stages = stageTable(evs, res.ctrl, extra ? ALLJ : PRIM);
  out.withoutMostActive = {}; for (const K of CFG.report.withoutMostActive) { const drop = new Set(rk.slice(0, K).map(x => x[0])), rest = evs.filter(e => !drop.has(e.sym)); out.withoutMostActive[K] = { dropped: [...drop].map(s => s.replace('USDT', '')), stages: stageTable(rest, res.ctrl, PRIM) }; }
  if (!extra) return out;
  out.byCoin = {}; for (const s of set) { const ce = evs.filter(e => e.sym === s); out.byCoin[s.replace('USDT', '')] = { Watch: compact(score(ce.filter(e => e.stage === 'Watch'), res.ctrl, PRIM)), Priority: compact(score(ce.filter(e => e.stage === 'Priority'), res.ctrl, PRIM)), Notification: compact(score(ce.filter(isNot), res.ctrl, PRIM)), Retest: compact(score(ce.filter(e => e.stage === 'Retest'), res.ctrl, PRIM)), Fade: compact(score(ce.filter(e => e.stage === 'Fade'), res.ctrl, PRIM)) }; }
  out.bySession = {}; for (let l = 0; l < LABELS.length; l++) { const le = evs.filter(e => e.lab === l); out.bySession[LABELS[l]] = { Watch: compact(score(le.filter(e => e.stage === 'Watch'), res.ctrl, PRIM)), Priority: compact(score(le.filter(e => e.stage === 'Priority'), res.ctrl, PRIM)), Notification: compact(score(le.filter(isNot), res.ctrl, PRIM)), Retest: compact(score(le.filter(e => e.stage === 'Retest'), res.ctrl, PRIM)), Fade: compact(score(le.filter(e => e.stage === 'Fade'), res.ctrl, PRIM)) }; }
  out.byHour = {}; for (const [nm, mask] of [['first hour of a session', 1 | 4 | 16], ['last hour of a session', 2 | 8 | 32], ['neither', 0]]) { const he = evs.filter(e => mask ? (e.tags & mask) : e.tags === 0); out.byHour[nm] = { Watch: compact(score(he.filter(e => e.stage === 'Watch'), res.ctrl, PRIM)), Priority: compact(score(he.filter(e => e.stage === 'Priority'), res.ctrl, PRIM)), Notification: compact(score(he.filter(isNot), res.ctrl, PRIM)) }; }
  out.byBlock = {}; for (const [nm, f] of [['first block (before the split)', e => e.i < SPLIT], ['second block (after the split)', e => e.i >= SPLIT]]) { const be = evs.filter(f); out.byBlock[nm] = { Watch: compact(score(be.filter(e => e.stage === 'Watch'), res.ctrl, PRIM)), Priority: compact(score(be.filter(e => e.stage === 'Priority'), res.ctrl, PRIM)), Notification: compact(score(be.filter(isNot), res.ctrl, PRIM)) }; }
  const bk = CFG.report.baselineBucketsUSDT, bn = i => i === 0 ? `baseline < ${bk[0] / 1000}k USDT` : i === bk.length ? `baseline >= ${bk[bk.length - 1] / 1000}k USDT` : `baseline ${bk[i - 1] / 1000}k to ${bk[i] / 1000}k USDT`;
  out.byBaseline = {}; for (let i = 0; i <= bk.length; i++) { const be = evs.filter(e => e.stage === 'Watch' && (i === 0 ? e.base < bk[0] : i === bk.length ? e.base >= bk[i - 1] : e.base >= bk[i - 1] && e.base < bk[i])); out.byBaseline[bn(i)] = compact(score(be, res.ctrl, PRIM)); }
  const P = evs.filter(e => e.stage === 'Priority' && e.tracked), RT = evs.filter(e => e.stage === 'Retest'), FD = evs.filter(e => e.stage === 'Fade'), EX = evs.filter(e => e.stage === 'Expired');
  out.followThrough = { trackedPriorities: P.length, retest: RT.length, fade: FD.length, expired: EX.length, retestShare: P.length ? RT.length / P.length : null, fadeShare: P.length ? FD.length / P.length : null, expiredShare: P.length ? EX.length / P.length : null,
    afterNotification: { n: P.filter(e => e.notif).length, retest: RT.filter(e => e.pNotif).length, fade: FD.filter(e => e.pNotif).length, expired: EX.filter(e => e.pNotif).length } };
  return out;
}

// ---------------------------------------------------------------- csv and report
const CSVH = 'coin,close_berlin,open_utc,stage,session,hour_tag,buy_volume_x,baseline_usdt,taker_buy_usdt,close,bos,vwap,rsi_1h,macd_hist_1h,late_spike,same_candle_watch,notification,pending_priority_tracked,candles_after_priority,O1,O2,O3,N1,N2,N3,D1,D2,D3';
const tagText = g => X.TAGS.filter(t => g & t[0]).map(t => t[1]).join('; ');
const o3 = v => v < 0 ? 'pending' : String(v), f = (x, d = 6) => x === undefined || x === null || Number.isNaN(x) ? '' : (+x).toPrecision(d);
function csvRow(e, rules) {
  const useB = rules.h1Rule === 'beforeOpen', notif = e.stage === 'Priority' ? (e.notif ? 'NOTIFY' : e.same ? 'dashboard only (1H filter failed)' : 'dashboard only (not on the Watch candle)') : e.stage === 'Watch' ? 'dashboard only' : e.pNotif ? 'after a Notification' : 'after a dashboard-only Priority';
  return [e.sym.replace('USDT', ''), bt(e.t + M15), iso(e.t), e.stage, LABELS[e.lab], tagText(e.tags), f(e.mult, 4), f(e.base, 6), f(e.tq, 6), f(e.close), e.stage === 'Watch' ? '' : f(e.bos), f(e.vwap), f(useB ? e.rsiB : e.rsi, 4), f(useB ? e.macdHistB : e.macdHist, 4), e.late ? 'yes' : '', e.same === undefined ? '' : e.same ? 'yes' : 'no', notif, e.tracked === undefined ? '' : e.tracked ? 'yes' : 'no (another Priority pending)', e.k || '', ...e.out.map(o3)].join(',');
}
function tbl(head, rows) { return ['| ' + head.join(' | ') + ' |', '|' + head.map((h, i) => i ? '---:' : ':---').join('|') + '|', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n'); }
const cell = (s, k) => { const x = s[k]; return !x || !x.obs ? '-' : `${x.hit}/${x.obs} = ${pc(x.rate)}`; };
const liftc = (s, k) => { const x = s[k]; return !x || !x.obs ? '-' : `${pc(x.expected, 2)} (x${num(x.lift, 1)})`; };
const ciC = (s, k) => { const x = s[k]; return !x || !x.obs ? '-' : `${pc(x.lo)}-${pc(x.hi)}`; };
function stageRows(st) { return STAGES.map(([name]) => { const s = st[name]; return [name, String(s.n), cell(s, 'O1'), cell(s, 'O2'), cell(s, 'O3'), ciC(s, 'O3'), liftc(s, 'O3')]; }); }
const SH = ['Stage', 'Events', 'O1 next close', 'O2 next high', 'O3 any of 4 closes', 'O3 95% interval', 'O3 by chance (lift)'];

function report(R, ran) {
  const L = [], A = R.variants['as written'], nm = A.sets.named, al = A.sets.all;
  L.push('# Volume-spike radar replay (15m, Binance USDT spot)', '', `Run ${ran}. Paper only, not financial advice. Rules: engine/spike-radar2.config.json. Data window: ${DATA.fetchFrom.slice(0, 10)} to ${DATA.end.slice(0, 10)} (events from ${CFG.period.analysisFrom.slice(0, 10)}; the earlier weeks only build the baselines). Times are Berlin time in the CSV files.`, '');
  L.push('## Read this first', '', `- Coins: ${R.coverage.coins} downloaded (${R.coverage.named} of the 9 named ones). "named" = your nine; "all" = the nine plus the wider liquid USDT universe.`, `- Outcomes are scored from the alert close: O1 next 15m close > +5%, O2 next candle high > +5%, O3 any of the next four closes > +5%. Pending = not observable yet (end of data or a missing candle). O1 and O2 sit inside O3.`, `- "By chance" is the share of ordinary candles of the same coin and session that reach the same outcome; lift = hit rate / by chance. A hit rate only means something relative to that.`, `- "as written" is the setup exactly as you wrote it. The "cleaned" variant and the sensitivity variants are in the last section.`, '');
  for (const [title, S] of [['Your nine coins', nm], ['All coins downloaded', al]]) {
    L.push(`## As written: ${title} (${S.coins} coins)`, '', tbl(SH, stageRows(S.stages)), '', `Most active coins by Watch count: ${S.watchCountsTop.map(x => x.join(' ')).join(', ')}.`, '');
    for (const K of CFG.report.withoutMostActive) { const w = S.withoutMostActive[K]; L.push(`### Without the ${K} most active coins (${w.dropped.join(', ')})`, '', tbl(SH, STAGES.filter(s => ['Watch', 'Priority', 'Notification', 'Retest', 'Fade'].includes(s[0])).map(([name]) => { const s = w.stages[name]; return [name, String(s.n), cell(s, 'O1'), cell(s, 'O2'), cell(s, 'O3'), ciC(s, 'O3'), liftc(s, 'O3')]; })), ''); }
  }
  const SC = ['Coin', 'Watch', 'Watch O3', 'Priority', 'Priority O3', 'Notification', 'Notification O3', 'Retest', 'Fade'];
  L.push('## By coin (as written, your nine)', '', tbl(SC, Object.entries(nm.byCoin).map(([c, z]) => [c, String(z.Watch.n), cell(z.Watch, 'O3'), String(z.Priority.n), cell(z.Priority, 'O3'), String(z.Notification.n), cell(z.Notification, 'O3'), String(z.Retest.n), String(z.Fade.n)])), '');
  for (const [title, S] of [['your nine', nm], ['all coins', al]]) {
    L.push(`## By session (as written, ${title})`, '', tbl(['Session', 'Watch', 'Watch O3', 'Priority', 'Priority O3', 'Notification', 'Notification O3', 'Retest', 'Fade'], Object.entries(S.bySession).map(([c, z]) => [c, String(z.Watch.n), cell(z.Watch, 'O3'), String(z.Priority.n), cell(z.Priority, 'O3'), String(z.Notification.n), cell(z.Notification, 'O3'), String(z.Retest.n), String(z.Fade.n)])), '', tbl(['Hour of a session', 'Watch', 'Watch O3', 'Priority', 'Priority O3', 'Notification', 'Notification O3'], Object.entries(S.byHour).map(([c, z]) => [c, String(z.Watch.n), cell(z.Watch, 'O3'), String(z.Priority.n), cell(z.Priority, 'O3'), String(z.Notification.n), cell(z.Notification, 'O3')])), '');
  }
  L.push('## Stability across time and baseline size (as written, all coins)', '', tbl(['Block', 'Watch', 'Watch O3', 'Priority', 'Priority O3', 'Notification', 'Notification O3'], Object.entries(al.byBlock).map(([c, z]) => [c, String(z.Watch.n), cell(z.Watch, 'O3'), String(z.Priority.n), cell(z.Priority, 'O3'), String(z.Notification.n), cell(z.Notification, 'O3')])), '', tbl(['Watch candles by baseline', 'Events', 'O3 hits'], Object.entries(al.byBaseline).map(([c, z]) => [c, String(z.n), cell(z, 'O3')])), '');
  const ft = al.followThrough, fn = nm.followThrough;
  L.push('## Priority follow-through (one pending Priority per coin)', '', tbl(['Set', 'Tracked Priorities', 'Retest', 'Fade', 'Expired (4 closes, neither)'], [['your nine', String(fn.trackedPriorities), `${fn.retest} (${pc(fn.retestShare)})`, `${fn.fade} (${pc(fn.fadeShare)})`, `${fn.expired} (${pc(fn.expiredShare)})`], ['all coins', String(ft.trackedPriorities), `${ft.retest} (${pc(ft.retestShare)})`, `${ft.fade} (${pc(ft.fadeShare)})`, `${ft.expired} (${pc(ft.expiredShare)})`]]), '');
  L.push('## Data checks', '', tbl(['Session', 'Candles', 'No usable baseline'], R.coverage.byLab.map(z => [z.lab, String(z.candles), `${z.noBaseline} (${pc(z.candles ? z.noBaseline / z.candles : null)})`])), '', `Look-ahead slip: of the Watch+Priority same-candle events, ${pc(R.slip.share)} get a different 1H verdict when the 1H bar that ends exactly at the event close is not allowed (as written lets it in whenever the event candle is the last quarter of an hour).`, '', `Coins that could not be used: ${Object.keys(R.coverage.failed).length ? Object.entries(R.coverage.failed).map(([k, v]) => k + ' (' + v + ')').join(', ') : 'none'}.`, '');
  const VH = ['Variant', 'Watch (all)', 'Priority (all)', 'Notification (all)', 'Notification O1/O2/O3 (all)', 'O3 vs chance', 'Notification (nine)', 'Notification O3 (nine)'];
  L.push('## Variants and sensitivity', '', tbl(VH, Object.entries(R.variants).map(([name, v]) => { const a = v.sets.all.stages, n = v.sets.named.stages; return [name, String(a['Watch'].n), String(a['Priority'].n), String(a['Notification'].n), `${cell(a['Notification'], 'O1')}; ${cell(a['Notification'], 'O2')}; ${cell(a['Notification'], 'O3')}`, liftc(a['Notification'], 'O3'), String(n['Notification'].n), cell(n['Notification'], 'O3')]; })), '', '"cleaned" = Watch and Priority events within 4 candles of the previous one dropped, baseline at least 10,000 USDT, Late-spike candles cannot notify, 1H bar must be closed before the event candle opens. To try other settings edit spike-radar2.config.json (variants list) and push.', '');
  return L.join('\n');
}

// ---------------------------------------------------------------- main
(async () => {
  const t0 = Date.now(), ran = new Date().toISOString().slice(0, 16) + 'Z', L = await loadAll();
  const syms = L.syms, grid = X.buildGrid(CFG, T0, N), named = syms.filter(s => NAMED.includes(s));
  console.log(`${syms.length} coins (${named.length} named), N=${N} candles, analysis from index ${A0}, ${L.cached ? 'cached' : 'downloaded'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const R = { about: 'Volume-spike radar replay. Paper only. Not financial advice.', ran, config: CFG, data: DATA, variants: {}, outcomes: OUTTXT };
  let main = null;
  for (const v of CFG.variants) {
    const res = runVariant(v, grid, L.data, syms); if (!main) main = res;
    R.variants[v.name] = { rules: res.rules, extras: { dedupeCandles: v.dedupeCandles || 0, excludeLateFromNotification: !!v.excludeLateFromNotification }, sets: { named: summariseSet(res, named, v.name === 'as written'), all: summariseSet(res, syms, v.name === 'as written') } };
    console.log(`variant ${v.name}: ${res.events.length} events`);
    if (v.name === 'as written') {
      const rows = (set, pred) => res.events.filter(e => set.has(e.sym) && pred(e)).sort((a, b) => a.t - b.t || a.sym.localeCompare(b.sym)).map(e => csvRow(e, res.rules));
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'events-named-as-written.csv'), [CSVH, ...rows(new Set(named), () => true)].join('\n') + '\n');
      fs.writeFileSync(path.join(OUT, 'events-all-priority-and-later-as-written.csv'), [CSVH, ...rows(new Set(syms), e => e.stage !== 'Watch')].join('\n') + '\n');
      const same = res.events.filter(e => e.stage === 'Priority' && e.same); let diff = 0; for (const e of same) if (!!e.notified !== !!e.notifiedB) diff++;
      R.slip = { samePriority: same.length, differ: diff, share: same.length ? diff / same.length : null };
      const byLab = LABELS.map(lab => ({ lab, candles: 0, noBaseline: 0 })); for (const s of syms) res.cov[s].byLab.forEach((z, i) => { byLab[i].candles += z.candles; byLab[i].noBaseline += z.noBaseline; });
      R.coverage = { coins: syms.length, named: named.length, failed: L.failed, byLab, perCoin: Object.fromEntries(named.map(s => [s.replace('USDT', ''), { first: iso(res.cov[s].first), last: iso(res.cov[s].last), candles: res.cov[s].candles, missing: res.cov[s].missing, noBaseline: res.cov[s].noBaseline }])) };
    }
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(R));
  fs.writeFileSync(path.join(OUT, 'report.md'), report(R, ran));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error(e); process.exit(1); });
