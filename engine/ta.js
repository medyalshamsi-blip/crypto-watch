// generated from dashboard.src.html by make_engine.py: do not edit by hand
const P = require('./playbook.js');
const ok = x => x != null && Number.isFinite(x), last = a => a[a.length - 1];
const nf = (x, d) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function fp(x) { if (!ok(x)) return '-'; const a = Math.abs(x); return a >= 10000 ? nf(x, 0) : a >= 100 ? nf(x, 2) : a >= 1 ? nf(x, 3) : x.toPrecision(4); }
function mainRead(d) {
  const c = d.c, n = c.length, c0 = c[n - 1];
  const E20 = last(P.ema(c, 20)), E50 = last(P.ema(c, 50)), E200 = last(P.ema(c, 200)), M = P.macd(c), R = last(P.rsi(c));
  const m = last(M.macd), sg = last(M.signal);
  const sig = [
    [c0 > E200 ? 1 : -1, `close ${c0 > E200 ? 'above' : 'below'} EMA200 (${fp(E200)})`],
    [E20 > E50 ? 1 : -1, `EMA20 ${E20 > E50 ? 'above' : 'below'} EMA50`],
    [m > sg ? 1 : -1, `MACD ${m > sg ? 'above' : 'below'} its signal line`],
    [m > 0 ? 1 : -1, `MACD ${m > 0 ? 'above' : 'below'} zero`],
    [R > 55 ? 1 : R < 45 ? -1 : 0, `RSI ${R.toFixed(1)}${R > 55 ? ' (above 55)' : R < 45 ? ' (below 45)' : ' (neutral)'}`]];
  const score = sig.reduce((s, x) => s + x[0], 0);
  return { sig, score, bias: score >= 3 ? 'Bullish' : score <= -3 ? 'Bearish' : 'Mixed', rsi: R, macdUp: m > sg, histUp: last(M.hist) > M.hist[n - 2],
    stack: c0 > E20 && E20 > E50 && E50 > E200 ? 'bull stack' : c0 < E20 && E20 < E50 && E50 < E200 ? 'bear stack' : 'mixed', above200: c0 > E200 };
}

function pivotsK(x, k, hi) {                 // k-candle swing points; equal neighbours to the right still count
  const out = [], n = x.length;
  for (let i = k; i < n - k; i++) {
    if (!ok(x[i])) continue; let good = true;
    for (let m = 1; m <= k && good; m++) good = hi ? x[i] > x[i - m] && x[i] >= x[i + m] : x[i] < x[i - m] && x[i] <= x[i + m];
    if (good) out.push(i);
  }
  return out;
}
function ta(d) {
  const n = d.c.length, { h, l, c, v } = d, A = P.atr(d), a0 = last(A) || (last(h) - last(l)), px = c[n - 1], out = { n, atr: a0 };
  // 1. BoS / CHoCH: the scanner's close-based walk, keeping the swing each break came from
  const st = P.structure(d), K = 2; let bh = -1, bl = -1, trend = null; const ev = [];
  const lastP = (arr, lo, t) => { let r = null; for (const i of arr) { if (i + K > t) break; if (i > lo) r = i; } return r; };
  for (let t = 0; t < n; t++) {
    const sh = lastP(st.ph, bh, t), sl = lastP(st.pl, bl, t);
    if (sh !== null && c[t] > h[sh]) { ev.push({ from: sh, t, p: h[sh], up: true, kind: trend === 'down' ? 'CHoCH' : 'BoS' }); trend = 'up'; bh = sh; }
    else if (sl !== null && c[t] < l[sl]) { ev.push({ from: sl, t, p: l[sl], up: false, kind: trend === 'up' ? 'CHoCH' : 'BoS' }); trend = 'down'; bl = sl; }
  }
  out.events = ev; out.trend = trend;
  // 2. swing labels on 5-candle swings: higher high, lower high, higher low, lower low
  const SH = pivotsK(h, 5, true), SL = pivotsK(l, 5, false), sw = [];
  SH.forEach((i, j) => { if (j) sw.push({ i, p: h[i], hi: true, lab: h[i] > h[SH[j - 1]] ? 'HH' : 'LH' }); });
  SL.forEach((i, j) => { if (j) sw.push({ i, p: l[i], hi: false, lab: l[i] < l[SL[j - 1]] ? 'LL' : 'HL' }); });
  out.swings = sw.sort((a, b) => a.i - b.i);
  // 3. dealing range from the last swing high and low; equilibrium splits premium from discount
  if (SH.length && SL.length) {
    const a = Math.min(last(SH), last(SL)); let iH = a, iL = a;
    for (let i = a; i < n; i++) { if (h[i] > h[iH]) iH = i; if (l[i] < l[iL]) iL = i; }
    const hi = h[iH], lo = l[iL], eq = (hi + lo) / 2;
    if (hi > lo) out.range = { from: a, iH, iL, hi, lo, eq, pos: (px - lo) / (hi - lo), zone: px > eq ? 'premium' : 'discount' };
  }
  // 4. equal highs and lows (within 0.1 ATR) that price has not run yet
  const tol = .1 * a0, eqs = [];
  for (const [arr, src, up] of [[st.ph, h, true], [st.pl, l, false]]) {
    const rec = arr.filter(i => i >= n - 200 && i + K < n);
    for (let x = rec.length - 1; x > 0 && eqs.filter(e => e.hi === up).length < 3; x--) {
      const j = rec[x];
      for (let y = x - 1; y >= 0 && j - rec[y] <= 120; y--) {
        const i = rec[y]; if (j - i < 3 || Math.abs(src[i] - src[j]) > tol) continue;
        const lvl = up ? Math.max(src[i], src[j]) : Math.min(src[i], src[j]);
        if (eqs.some(e => e.hi === up && Math.abs(e.p - lvl) <= tol)) break;
        let clean = true; for (let t = i + 1; t < n && clean; t++) if (t !== j && (up ? h[t] > lvl : l[t] < lvl)) clean = false;
        if (clean) { eqs.push({ i, j, p: lvl, hi: up }); break; }
      }
    }
  }
  out.eq = eqs;
  // 5. support and resistance areas: three or more swing points within 0.6 ATR of each other (last 300 candles)
  const pts = [...st.ph.filter(i => i >= n - 300 && i + K < n).map(i => ({ i, p: h[i] })), ...st.pl.filter(i => i >= n - 300 && i + K < n).map(i => ({ i, p: l[i] }))].sort((a, b) => a.p - b.p);
  const cl = []; let cur = null;
  for (const q of pts) { if (cur && q.p - cur.lo <= .6 * a0) { cur.m.push(q); cur.hi = q.p; } else { cur = { lo: q.p, hi: q.p, m: [q] }; cl.push(cur); } }
  const zones = cl.filter(z => z.m.length >= 3).map(z => { const pad = Math.max(0, .15 * a0 - (z.hi - z.lo) / 2); return { lo: z.lo - pad, hi: z.hi + pad, touches: z.m.length, first: Math.min(...z.m.map(q => q.i)), lastI: Math.max(...z.m.map(q => q.i)) }; });
  const sup = zones.filter(z => z.hi < px).sort((a, b) => b.hi - a.hi).slice(0, 2).map(z => Object.assign({ kind: 'S' }, z));
  const res = zones.filter(z => z.lo > px).sort((a, b) => a.lo - b.lo).slice(0, 2).map(z => Object.assign({ kind: 'R' }, z));
  out.sr = [...zones.filter(z => z.lo <= px && z.hi >= px).map(z => Object.assign({ kind: 'at' }, z)), ...sup, ...res];
  // 6. breakouts: the first close beyond the prior 20-candle range, or through a support / resistance area
  const rv = P.relPrior(v), hasV = v.some(x => x > 0), brk = [], from = Math.max(22, n - 150);
  for (let t = from; t < n; t++) {
    let hh = -Infinity, ll = Infinity, h2 = -Infinity, l2 = Infinity;
    for (let q = t - 20; q < t; q++) { hh = Math.max(hh, h[q]); ll = Math.min(ll, l[q]); }
    for (let q = t - 21; q < t - 1; q++) { h2 = Math.max(h2, h[q]); l2 = Math.min(l2, l[q]); }
    let dir = c[t] > hh && c[t - 1] <= h2 ? 1 : c[t] < ll && c[t - 1] >= l2 ? -1 : 0, kind = 'range';
    if (!dir) for (const z of zones) { if (t <= z.lastI + 2) continue; if (c[t] > z.hi && c[t - 1] <= z.hi) { dir = 1; kind = 'level'; break; } if (c[t] < z.lo && c[t - 1] >= z.lo) { dir = -1; kind = 'level'; break; } }
    if (dir) brk.push({ t, up: dir > 0, kind, rv: hasV ? rv[t] : NaN, vol: hasV && rv[t] >= 1.5 });
  }
  out.brk = brk; out.hasV = hasV;
  // 7. RSI and MACD signals, and divergences between 3-candle swings 5 to 60 candles apart
  const R = P.rsi(c), M = P.macd(c), rs = [], ms = [];
  for (let t = from; t < n; t++) {
    if (R[t - 1] < 50 && R[t] >= 50) rs.push({ t, up: true, kind: '50' }); else if (R[t - 1] > 50 && R[t] <= 50) rs.push({ t, up: false, kind: '50' });
    if (R[t - 1] <= 30 && R[t] > 30) rs.push({ t, up: true, kind: 'oversold exit' }); else if (R[t - 1] >= 70 && R[t] < 70) rs.push({ t, up: false, kind: 'overbought exit' });
    const d0 = M.macd[t - 1] - M.signal[t - 1], d1 = M.macd[t] - M.signal[t];
    if (d0 <= 0 && d1 > 0) ms.push({ t, up: true, kind: 'signal' }); else if (d0 >= 0 && d1 < 0) ms.push({ t, up: false, kind: 'signal' });
    if (M.macd[t - 1] <= 0 && M.macd[t] > 0) ms.push({ t, up: true, kind: 'zero' }); else if (M.macd[t - 1] >= 0 && M.macd[t] < 0) ms.push({ t, up: false, kind: 'zero' });
  }
  const H3 = pivotsK(h, 3, true).filter(i => i >= n - 200), L3 = pivotsK(l, 3, false).filter(i => i >= n - 200);
  const div = osc => {
    const o = [];
    for (let x = 1; x < L3.length; x++) { const i = L3[x - 1], j = L3[x]; if (j - i >= 5 && j - i <= 60 && l[j] < l[i] && osc[j] > osc[i]) o.push({ i, j, up: true, pi: l[i], pj: l[j], oi: osc[i], oj: osc[j] }); }
    for (let x = 1; x < H3.length; x++) { const i = H3[x - 1], j = H3[x]; if (j - i >= 5 && j - i <= 60 && h[j] > h[i] && osc[j] < osc[i]) o.push({ i, j, up: false, pi: h[i], pj: h[j], oi: osc[i], oj: osc[j] }); }
    return o.sort((a, b) => a.j - b.j).slice(-4);
  };
  out.R = R; out.M = M; out.rsiSig = rs; out.macdSig = ms; out.rsiDiv = div(R); out.macdDiv = div(M.macd);
  // 8. trendlines through the last swing and an earlier one that no close crossed in between; first close through it
  const tline = (x, up, k, cc) => {
    const pv = pivotsK(x, k, up); if (pv.length < 2) return null; const j = last(pv);
    for (let y = pv.length - 2; y >= 0 && j - pv[y] <= 150; y--) {
      const i = pv[y]; if (j - i < 5) continue; const m = (x[j] - x[i]) / (j - i), at = t => x[i] + m * (t - i);
      let good = true; for (let t = i + 1; t < j && good; t++) if (up ? cc[t] > at(t) : cc[t] < at(t)) good = false;
      if (!good) continue;
      let br = null; for (let t = j + 1; t < n; t++) if (up ? cc[t] > at(t) : cc[t] < at(t)) { br = t; break; }
      return { i, j, at, br, up, end: br != null ? br : n - 1 + 6 };
    }
    return null;
  };
  out.tl = { price: [tline(h, true, 3, c), tline(l, false, 3, c)], rsi: [tline(R, true, 3, R), tline(R, false, 3, R)], macd: [tline(M.macd, true, 3, M.macd), tline(M.macd, false, 3, M.macd)] };
  return out;
}

module.exports = { mainRead, ta, pivotsK, fp };
