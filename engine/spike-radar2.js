'use strict';
// 15-minute volume-spike radar: the rules only (no network). Stages: Watch, Priority, Notification, Retest, Fade (and Expired).
// Used by engine/spike-radar2-test.js (replay on Binance history) and later by the dashboard. Paper only. Not financial advice.
// Every threshold lives in engine/spike-radar2.config.json. Only completed candles are used, and every check at candle i uses
// data up to the close of candle i (the calendar, the baseline of earlier matching slots, VWAP, the earlier 8 highs, completed 1H bars).
const M15 = 900e3, H1 = 3600e3, DAY = 864e5;
const LABELS = ['TYO', 'LON', 'NY', 'LON-NY', 'OFF-WKDY', 'OFF-WKND'];
const OUT = ['O1', 'O2', 'O3', 'N1', 'N2', 'N3', 'D1', 'D2', 'D3'];     // outcome codes, see outcomesAt
const TAGS = [[1, 'TYO first hour'], [2, 'TYO last hour'], [4, 'LON first hour'], [8, 'LON last hour'], [16, 'NY first hour'], [32, 'NY last hour']];
const hm = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };

// ---------------------------------------------------------------- calendar and sessions (one grid shared by all coins)
const fmtCache = new Map();
function zoneOffsetMs(tz, t) {                     // offset of a time zone from UTC at time t (handles daylight saving)
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); fmtCache.set(tz, f); }
  const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
// For every 15m slot from t0: primary session label, baseline slot key, VWAP anchor, early-close flag and first/last-hour tags.
function buildGrid(cfg, t0, N) {
  const S = cfg.sessions, loc = {};
  for (const name of ['TSE', 'LSE', 'NYSE']) {
    const h = S.hours[name], hol = new Set(S.holidays[name] || []), early = (S.earlyClose && S.earlyClose[name]) || {};
    const open = hm(h.open), close = hm(h.close), lunch = h.lunch ? [hm(h.lunch[0]), hm(h.lunch[1])] : null, offs = new Map();
    const L = loc[name] = { in: new Uint8Array(N), min: new Int16Array(N), start: new Int32Array(N).fill(-1), close: new Int16Array(N), early: new Uint8Array(N) };
    let start = -1, prevIn = false, prevDate = -1;
    for (let i = 0; i < N; i++) {
      const t = t0 + i * M15, hk = Math.floor(t / H1); let off = offs.get(hk); if (off === undefined) { off = zoneOffsetMs(h.tz, t); offs.set(hk, off); }
      const lt = t + off, date = Math.floor(lt / DAY), min = Math.floor((lt - date * DAY) / 60000), dow = (date + 4) % 7;
      const ymd = new Date(date * DAY).toISOString().slice(0, 10), ec = early[ymd], closeMin = ec ? hm(ec) : close;
      let inS = dow >= 1 && dow <= 5 && !hol.has(ymd) && min >= open && min + 15 <= closeMin;
      if (inS && lunch && S.tokyoLunch === 'outside' && min >= lunch[0] && min < lunch[1]) inS = false;
      if (inS && (!prevIn || prevDate !== date)) start = i;
      L.in[i] = inS ? 1 : 0; L.min[i] = min; L.start[i] = inS ? start : -1; L.close[i] = closeMin; L.early[i] = ec ? 1 : 0;
      prevIn = inS; prevDate = date;
    }
  }
  const lab = new Uint8Array(N), key = new Int32Array(N), anchor = new Int32Array(N), early = new Uint8Array(N), tags = new Uint8Array(N);
  const ids = new Map(), keyNames = [], kid = s => { let k = ids.get(s); if (k === undefined) { k = keyNames.length; ids.set(s, k); keyNames.push(s); } return k; };
  const T = loc.TSE, Lc = loc.LSE, Ny = loc.NYSE;
  for (let i = 0; i < N; i++) {
    const t = t0 + i * M15, inT = T.in[i], inL = Lc.in[i], inN = Ny.in[i]; let l, k, a, e = 0, g = 0;
    if (inL && inN) { l = 3; k = kid('LN|' + Ny.min[i]); a = S.vwapInOverlap === 'london' ? Lc.start[i] : Ny.start[i]; e = Ny.early[i] | Lc.early[i]; }
    else if (inN) { l = 2; k = kid('NY|' + Ny.min[i]); a = Ny.start[i]; e = Ny.early[i]; }
    else if (inL) { l = 1; k = kid('LON|' + Lc.min[i]); a = Lc.start[i]; e = Lc.early[i]; }
    else if (inT) { l = 0; k = kid('TYO|' + T.min[i]); a = T.start[i]; e = T.early[i]; }
    else { const dow = (Math.floor(t / DAY) + 4) % 7; l = dow === 0 || dow === 6 ? 5 : 4; k = kid((l === 5 ? 'OE|' : 'OW|') + Math.floor((t % DAY) / 60000)); a = i - Math.floor((t % DAY) / M15); }
    if (inT) { if (i - T.start[i] < 4) g |= 1; if (T.close[i] - (T.min[i] + 15) < 60) g |= 2; }
    if (inL) { if (i - Lc.start[i] < 4) g |= 4; if (Lc.close[i] - (Lc.min[i] + 15) < 60) g |= 8; }
    if (inN) { if (i - Ny.start[i] < 4) g |= 16; if (Ny.close[i] - (Ny.min[i] + 15) < 60) g |= 32; }
    lab[i] = l; key[i] = k; anchor[i] = Math.max(0, a); early[i] = e; tags[i] = g;
  }
  return { t0, N, lab, key, keyNames, anchor, early, tags };
}

// ---------------------------------------------------------------- small indicator helpers
function median(a) { const s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function rsiSeries(c, n) {                         // Wilder RSI
  const out = new Float64Array(c.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { ag += up; al += dn; if (i === n) { ag /= n; al /= n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (n - 1) + up) / n; al = (al * (n - 1) + dn) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
function ema(x, n) { const a = 2 / (n + 1), o = new Float64Array(x.length); if (!x.length) return o; o[0] = x[0]; for (let i = 1; i < x.length; i++) o[i] = a * x[i] + (1 - a) * o[i - 1]; return o; }
function macdHist(c, f, s, g) { const e1 = ema(c, f), e2 = ema(c, s), line = e1.map((v, i) => v - e2[i]), sig = ema(line, g); return line.map((v, i) => v - sig[i]); }

// 1H bars from the 15m grid (UTC hours; a quiet hour carries the last close forward)
function hourly(C, ok, N, R, macd) {
  const NH = Math.ceil(N / 4), hc = new Float64Array(NH).fill(NaN); let first = -1, last = NaN;
  for (let k = 0; k < NH; k++) {
    let c = NaN; for (let q = 3; q >= 0; q--) { const i = 4 * k + q; if (i < N && ok[i]) { c = C[i]; break; } }
    if (!Number.isNaN(c)) { last = c; if (first < 0) first = k; }
    hc[k] = last;
  }
  const rsi = new Float64Array(NH).fill(NaN), hist = new Float64Array(NH).fill(NaN);
  if (first >= 0) {
    const s = hc.slice(first), r = rsiSeries(s, R.rsiPeriod), h = macdHist(s, macd[0], macd[1], macd[2]);
    for (let k = first + R.h1MinBars; k < NH; k++) { rsi[k] = r[k - first]; hist[k] = h[k - first]; }
  }
  return { rsi, hist, first };
}

// ---------------------------------------------------------------- outcomes
// O: from the alert close. N: from the next open. D: the mirror, a fall of the same size.  1 = hit, 0 = miss, -1 = pending / not observed.
// x1 next close, x2 next high (low for D), x3 any of the next `horizon` closes.   first: 1 up first, 2 down first, 0 neither, -1 not observed.
function outcomesAt(g, i, N, gain, horizon) {
  const { C, O, Hh, Ll, ok } = g, o = new Int8Array(9).fill(-1), up = C[i] * (1 + gain), dn = C[i] * (1 - gain);
  const have1 = i + 1 < N && ok[i + 1], E = have1 ? O[i + 1] : NaN, upE = E * (1 + gain);
  if (have1) { o[0] = C[i + 1] > up ? 1 : 0; o[1] = Hh[i + 1] > up ? 1 : 0; o[3] = C[i + 1] > upE ? 1 : 0; o[4] = Hh[i + 1] > upE ? 1 : 0; o[6] = C[i + 1] < dn ? 1 : 0; o[7] = Ll[i + 1] < dn ? 1 : 0; }
  let hit = 0, hitN = 0, hitD = 0, all = true, first = null;
  for (let k = 1; k <= horizon; k++) {
    const j = i + k; if (j >= N || !ok[j]) { all = false; continue; }
    const c = C[j]; if (c > up) hit = 1; if (c < dn) hitD = 1; if (have1 && c > upE) hitN = 1;
    if (first === null && (c > up || c < dn)) first = c > up ? 1 : 2;
  }
  o[2] = hit ? 1 : all ? 0 : -1; o[8] = hitD ? 1 : all ? 0 : -1; o[5] = !have1 ? -1 : hitN ? 1 : all ? 0 : -1;
  return { o, first: first !== null ? first : all ? 0 : -1 };
}

function gridCoin(m, t0, N) {
  const mk = () => new Float64Array(N).fill(NaN), g = { O: mk(), Hh: mk(), Ll: mk(), C: mk(), Q: mk(), TQ: mk(), ok: new Uint8Array(N), N };
  for (let r = 0; r < m.t.length; r++) {
    const i = Math.round((m.t[r] - t0) / M15); if (i < 0 || i >= N) continue;
    g.O[i] = m.o[r]; g.Hh[i] = m.h[r]; g.Ll[i] = m.l[r]; g.C[i] = m.c[r]; g.Q[i] = m.q[r]; g.TQ[i] = m.tq[r]; g.ok[i] = 1;
  }
  return g;
}

// ---------------------------------------------------------------- the radar for one coin
// m: { t, o, h, l, c, q, tq } 15m candles (q = quote volume, tq = taker-buy quote volume). A0 = first grid index to record events from.
function analyseCoin(sym, m, grid, cfg, A0, N) {
  const R = cfg.rules, X = cfg.outcomes, g = gridCoin(m, grid.t0, N), { C, O, Hh, Ll, Q, TQ, ok } = g, t0 = grid.t0;
  const cpv = new Float64Array(N + 1), cv = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) { const q = ok[i] ? Q[i] : 0; cpv[i + 1] = cpv[i] + (ok[i] ? (Hh[i] + Ll[i] + C[i]) / 3 * q : 0); cv[i + 1] = cv[i] + q; }
  const vwap = i => { const a = grid.anchor[i], v = cv[i + 1] - cv[a]; return v > 0 ? (cpv[i + 1] - cpv[a]) / v : NaN; };
  // baseline: median taker-buy quote volume of the previous N matching slots (same session label and local clock time, or the same UTC time off-session)
  const base = new Float64Array(N).fill(NaN), hist = new Map(), maxAge = R.baselineMaxAgeDays * DAY, K = R.baselineSlots, scratch = new Float64Array(K);
  for (let i = 0; i < N; i++) {
    if (!ok[i]) continue;
    const kid = grid.key[i], t = t0 + i * M15; let H = hist.get(kid); if (!H) { H = []; hist.set(kid, H); }
    if (H.length >= K && t - H[H.length - K].t <= maxAge) { for (let q = 0; q < K; q++) scratch[q] = H[H.length - K + q].v; scratch.sort(); base[i] = K % 2 ? scratch[K >> 1] : (scratch[K / 2 - 1] + scratch[K / 2]) / 2; }
    if (!(grid.early[i] && cfg.sessions.excludeEarlyCloseFromBaseline)) { H.push({ t, v: TQ[i] }); if (H.length > K * 2) H.shift(); }
  }
  const hr = hourly(C, ok, N, R, R.macd), NH = hr.rsi.length;
  const h1 = (i, rule) => { const k = (rule === 'beforeOpen' ? Math.floor((t0 + i * M15 - t0) / H1) : Math.floor((i * M15 + M15) / H1)) - 1; return k >= 0 && k < NH ? { rsi: hr.rsi[k], hist: hr.hist[k] } : { rsi: NaN, hist: NaN }; };
  const pass = x => !R.h1Filter || (x.rsi >= R.rsiMin && x.hist > R.macdHistMin);
  const row = (stage, i, extra) => {
    const oc = outcomesAt(g, i, N, X.gain, X.horizon);
    return Object.assign({ sym, stage, i, t: t0 + i * M15, lab: grid.lab[i], tags: grid.tags[i], mult: base[i] > 0 ? TQ[i] / base[i] : NaN, base: base[i], tq: TQ[i], close: C[i], vwap: vwap(i),
      late: C[i] / O[i] - 1 > R.lateSpikeReturn, out: Array.from(oc.o), first: oc.first }, extra);
  };
  const ev = []; let watches = [], pend = null;
  for (let i = 0; i < N; i++) {
    if (!ok[i]) continue;
    const rec = i >= A0;
    if (pend) {                                           // 1. the pending Priority: Fade, Retest or Expired on the next closes
      pend.n++; const bos = pend.bos, c = C[i]; let st = null;
      if (c <= bos) st = 'Fade'; else if (Ll[i] <= bos && c > bos && c > vwap(i)) st = 'Retest'; else if (pend.n >= R.stageWindow) st = 'Expired';
      if (st) { if (pend.rec) { const p = pend.row; ev.push(row(st, i, { bos, k: pend.n, pi: p.i, pNotified: p.notified, pNotifiedB: p.notifiedB, pLate: p.late, pBase: p.base })); } pend = null; }
    }
    const tq = TQ[i], b = base[i], watch = b > 0 && b >= R.minBaselineUSDT && tq / b >= R.watchMult;   // 2. Watch
    watches = watches.filter(w => w >= i - R.priorityWindowAfterWatch);
    if (watch) watches.push(i);
    let hi = NaN;                                         // 3. Priority: close above the highest high of the previous 8 candles and above VWAP, in the top share of the range
    if (watches.length) { hi = -Infinity; for (let q = i - R.priorityLookback; q < i; q++) { if (q < 0 || !ok[q]) { hi = NaN; break; } if (Hh[q] > hi) hi = Hh[q]; } }
    if (watch && rec) ev.push(row('Watch', i, { bos: hi }));
    if (watches.length && hi === hi) {
      const vw = vwap(i), range = Hh[i] - Ll[i];
      if (C[i] > hi && C[i] > vw && range > 0 && (C[i] - Ll[i]) / range >= 1 - R.closeInTopShare) {
        const a = h1(i, 'latestClosed'), bb = h1(i, 'beforeOpen'), same = watch, tracked = !pend || R.newPriorityWhilePending === 'replace';
        const p = row('Priority', i, { bos: hi, same, watchAge: i - watches[0], notified: same && pass(a), notifiedB: same && pass(bb), rsi: a.rsi, macdHist: a.hist, rsiB: bb.rsi, macdHistB: bb.hist, tracked });
        if (rec) ev.push(p);
        watches = [];
        if (tracked) pend = { n: 0, bos: hi, rec, row: p };
      }
    }
  }
  // control rates: how often the same outcomes happen after any candle of the same session label
  const rates = LABELS.map(() => ({ obs: new Int32Array(9), hit: new Int32Array(9), first: new Int32Array(3) }));
  const cov = { first: null, last: null, candles: 0, missing: 0, noBaseline: 0, byLab: LABELS.map(() => ({ candles: 0, noBaseline: 0 })) };
  for (let i = 0; i < N; i++) {
    if (ok[i]) { if (cov.first === null) cov.first = t0 + i * M15; cov.last = t0 + i * M15; }
    if (i < A0) continue;
    if (cov.first === null || t0 + i * M15 < cov.first) continue;
    if (!ok[i]) { cov.missing++; continue; }
    cov.candles++; cov.byLab[grid.lab[i]].candles++; if (!(base[i] > 0)) { cov.noBaseline++; cov.byLab[grid.lab[i]].noBaseline++; }
    const oc = outcomesAt(g, i, N, X.gain, X.horizon), Rt = rates[grid.lab[i]];
    for (let j = 0; j < 9; j++) if (oc.o[j] >= 0) { Rt.obs[j]++; if (oc.o[j] === 1) Rt.hit[j]++; }
    if (oc.first >= 0) Rt.first[oc.first]++;
  }
  return { events: ev, rates, cov };
}

module.exports = { M15, H1, DAY, LABELS, OUT, TAGS, buildGrid, analyseCoin, outcomesAt, gridCoin, median, rsiSeries, macdHist, ema, zoneOffsetMs };
