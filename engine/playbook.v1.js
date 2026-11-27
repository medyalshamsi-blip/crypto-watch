/* Playbook scanner, JavaScript port of claude/playbook-scanner.py (the trading project's rule book).
   Same rules, same thresholds; parity-tested against the Python version (parity.py / parity.js).
   Input: {t:[ms], o:[], h:[], l:[], c:[], v:[]} daily bars, oldest first. The last bar may be forming. */
(function (root) {
  'use strict';
  const isNum = Number.isFinite;
  const mean = a => { let s = 0, k = 0; for (const x of a) if (!Number.isNaN(x)) { s += x; k++; } return k ? s / k : NaN; };
  const minA = a => a.length ? Math.min(...a) : NaN;
  const maxA = a => a.length ? Math.max(...a) : NaN;
  const argmin = a => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] < a[b]) b = i; return b; };
  const argmax = a => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

  // pandas ewm(adjust=False): starts at the first finite value
  function ewm(x, alpha) {
    const out = new Array(x.length).fill(NaN); let y = NaN, on = false;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (!on) { if (isNum(v)) { y = v; on = true; out[i] = y; } continue; }
      if (!Number.isNaN(v)) y = (1 - alpha) * y + alpha * v;
      out[i] = y;
    }
    return out;
  }
  const ema = (x, n) => ewm(x, 2 / (n + 1));
  const rma = (x, n) => ewm(x, 1 / n);
  function rsi(c, n = 14) {
    const g = c.map((x, i) => i ? Math.max(x - c[i - 1], 0) : NaN), l = c.map((x, i) => i ? Math.max(c[i - 1] - x, 0) : NaN);
    const G = rma(g, n), L = rma(l, n);
    return G.map((x, i) => 100 - 100 / (1 + x / L[i]));
  }
  function atr(d, n = 14) {
    const tr = d.h.map((h, i) => i ? Math.max(h - d.l[i], Math.abs(h - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : h - d.l[i]);
    return rma(tr, n);
  }
  function macd(c, f = 12, s = 26, g = 9) {
    const a = ema(c, f), b = ema(c, s), m = a.map((x, i) => x - b[i]), sig = ema(m, g);
    return { macd: m, signal: sig, hist: m.map((x, i) => x - sig[i]) };
  }
  // x[i] / mean of the prior 20 values (pandas rolling(20).mean().shift(1))
  function relPrior(x, n = 20) {
    const out = new Array(x.length).fill(NaN); let s = 0;
    for (let i = 0; i < x.length; i++) {
      if (i >= n) out[i] = x[i] / (s / n);
      s += x[i]; if (i >= n) s -= x[i - n];
    }
    return out;
  }

  // 5-bar fractals; a plateau of equal values is one pivot at its first bar
  function find(x, k) {
    const out = [], n = x.length;
    for (let i = k; i < n; i++) {
      if (x[i] === x[i - 1]) continue;
      let j = i; while (j + 1 < n && x[j + 1] === x[i]) j++;
      if (j + k >= n) continue;
      let ok = true;
      for (let m = 1; m <= k && ok; m++) ok = x[i] > x[i - m] && x[i] > x[j + m];
      if (ok) out.push(i);
    }
    return out;
  }
  const pivots = (d, k = 2) => [find(d.h, k), find(d.l.map(x => -x), k)];

  // close-based BOS / CHoCH walk; a pivot is usable k bars after it prints
  function structure(d, k = 2) {
    const [ph, pl] = pivots(d, k), { c, h, l } = d, n = c.length;
    let trend = null, bh = -1, bl = -1; const events = [];
    const last = (arr, lo, t) => { let r = null; for (const i of arr) if (lo < i && (t === undefined || i + k <= t)) r = i; return r; };
    for (let t = 0; t < n; t++) {
      const sh = last(ph, bh, t), sl = last(pl, bl, t);
      if (sh !== null && c[t] > h[sh]) {
        const strong = sh + argmin(l.slice(sh, t + 1));
        events.push({ t, kind: trend === 'down' ? 'CHoCH up' : 'BOS up', level: h[sh], strong }); trend = 'up'; bh = sh;
      } else if (sl !== null && c[t] < l[sl]) {
        const strong = sl + argmax(h.slice(sl, t + 1));
        events.push({ t, kind: trend === 'up' ? 'CHoCH down' : 'BOS down', level: l[sl], strong }); trend = 'down'; bl = sl;
      }
    }
    return { trend, events, ph, pl, sh: last(ph, bh), sl: last(pl, bl) };
  }

  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = ms => { const d = new Date(ms); return String(d.getUTCDate()).padStart(2, '0') + ' ' + MON[d.getUTCMonth()]; };
  const g5 = x => isNum(x) ? Number(x.toPrecision(5)).toString() : '-';
  const pct = x => (x >= 0 ? '+' : '') + Math.round(x * 100) + '%';

  function scan(d, name = '') {
    const { t: T, o, h, l, c, v } = d, n = c.length;
    const A = atr(d), E20 = ema(c, 20), E50 = ema(c, 50), E200 = ema(c, 200), R = rsi(c);
    const rng = h.map((x, i) => x - l[i]);
    const rv = relPrior(v), rr = relPrior(rng);
    const clv = c.map((x, i) => rng[i] === 0 ? 0.5 : (x - l[i]) / rng[i]);
    const c0 = c[n - 1], a0 = A[n - 1];
    const S = structure(d), tr = S.trend, ev = S.events, up = tr === 'up';
    const pts = [], notes = [];
    const vote = (x, why) => pts.push([x, why]);

    // 1 bias: structure, EMAs, RSI regime
    const last = ev.length ? ev[ev.length - 1] : null;
    if (last) vote(up ? 2 : -2, `structure ${tr} since ${last.kind} ${dm(T[last.t])} at ${g5(last.level)}`);
    const strongI = last ? last.strong : null;
    const strongLv = last ? (up ? l : h)[strongI] : NaN;
    const e20 = E20[n - 1], e50 = E50[n - 1], e200 = E200[n - 1];
    const align = c0 > e20 && e20 > e50 && e50 > e200 ? 'bull' : c0 < e20 && e20 < e50 && e50 < e200 ? 'bear' : 'mixed';
    if (align !== 'mixed') vote(align === 'bull' ? 1 : -1, `EMA 20/50/200 stacked ${align}`);
    const r40 = R.slice(-40).filter(x => !Number.isNaN(x)), rmin = minA(r40), rmax = maxA(r40);
    const regime = rmin >= 38 && rmax >= 60 ? 'bull (40-80)' : rmax <= 62 && rmin <= 40 ? 'bear (20-60)' : 'transition';
    if (regime !== 'transition') vote(regime.startsWith('bull') ? 1 : -1, `RSI regime ${regime}, now ${R[n - 1].toFixed(1)}`);

    // 2 trend quality vs EMA20 inside the current trend (max 40 bars)
    let quality = 'n/a', t0 = n;
    if (tr) {
      t0 = last.t;
      for (let q = ev.length - 1; q >= 0; q--) { if (ev[q].kind.endsWith('up') !== up) break; t0 = ev[q].strong; }
      const start = Math.max(t0, n - 40), len = n - start;
      if (len < 10) quality = `too young to grade (${len} bars)`;
      else {
        let wrong = 0, exc = -Infinity;
        for (let i = start; i < n; i++) {
          if (up ? c[i] < E20[i] : c[i] > E20[i]) wrong++;
          exc = Math.max(exc, Math.max(up ? E20[i] - l[i] : h[i] - E20[i], 0) / A[i]);
        }
        wrong /= len;
        quality = wrong <= .10 && exc <= .5 ? 'strong' : wrong <= .35 && exc <= 1.5 ? 'healthy' : 'weak/choppy';
        quality += ` (${Math.round(wrong * 100)}% of closes on the wrong side of EMA20, max excursion ${exc.toFixed(1)} ATR, ${len} bars)`;
      }
    }

    // 3 current leg: impulse vs pullback
    let pull = 'n/a', gz = false;
    if (last) {
      const s = strongI;
      const ext = s + (up ? argmax(h.slice(s)) : argmin(l.slice(s)));
      const leg = up ? Math.abs(h[ext] - l[s]) : Math.abs(h[s] - l[ext]);
      if (ext + 1 < n) {
        const P = []; for (let i = ext + 1; i < n; i++) P.push(i);
        const depth = (up ? h[ext] - minA(P.map(i => l[i])) : maxA(P.map(i => h[i])) - l[ext]) / leg;
        const impV = []; for (let i = s; i <= ext; i++) impV.push(v[i]);
        const vr = mean(P.map(i => v[i])) / mean(impV);
        const counter = P.some(i => rr[i] > 1.5 && (up ? clv[i] < .3 : clv[i] > .7));
        let run = 0;
        if (P.length > 1) { let cur = 0; for (let q = 1; q < P.length; q++) { const st = up ? l[P[q]] - l[P[q - 1]] < 0 : h[P[q]] - h[P[q - 1]] > 0; cur = st ? cur + 1 : 0; run = Math.max(run, cur); } }
        const sig = (depth > .618) + (vr >= 1) + counter + (run >= 4);
        pull = sig >= 2 ? 'strong (range/reversal risk)' : depth < .5 && vr < .8 && !counter ? 'weak (continuation)' : 'moderate';
        notes.push(`pullback ${pull}: depth ${Math.round(depth * 100)}% of leg, volume ${vr.toFixed(2)}x impulse, strong counter bar ${counter ? 'yes' : 'no'}, ${run} straight ${up ? 'lower lows' : 'higher highs'}`);
        if (pull.startsWith('weak')) vote(up ? 1 : -1, 'pullback is weak, so the trend should continue');
        else if (pull.startsWith('strong')) vote(up ? -1 : 1, 'pullback is strong, so trend continuation is at risk');
        const fib = up ? (h[ext] - c0) / leg : (c0 - l[ext]) / leg;
        gz = fib >= .5 && fib <= .618;
        notes.push(`price retraces ${Math.round(fib * 100)}% of the leg` + (gz ? ' (inside the 50-61.8% zone)' : ''));
      } else notes.push('no pullback yet: price is extending the leg');
    }

    // 4 thrust on the last two swings in trend direction
    const pv = (up ? S.ph : S.pl).filter(i => i >= t0);
    if (tr && pv.length >= 3) {
      const x = pv.slice(-3).map(i => up ? h[i] : -l[i]), t1 = x[1] - x[0], t2 = x[2] - x[1];
      if (t2 < t1) vote(up ? -1 : 1, `thrust shrinking (${(Math.abs(t2) / a0).toFixed(1)} vs ${(Math.abs(t1) / a0).toFixed(1)} ATR)`);
    }

    // 5 effort vs result: 20-bar price / volume
    const pc = c0 / c[n - 21] - 1, vc = mean(v.slice(-10)) / mean(v.slice(-20, -10)) - 1;
    const pvr = pc > 0 ? (vc > 0 ? 'strong bull' : 'weak bull') : (vc > 0 ? 'strong bear' : 'weak bear');
    vote({ 'strong bull': 1, 'weak bull': 0, 'strong bear': -1, 'weak bear': 0 }[pvr], `20-bar price ${pct(pc)} with volume ${pct(vc)}: ${pvr}`);

    // 6 last 3 bars: candle + volume flags; only the last two vote
    const flags = [], recentF = [];
    for (let i = n - 3; i < n; i++) {
      const body = Math.abs(c[i] - o[i]), r_ = (h[i] - l[i]) || 1e-12, upb = c[i] > c[i - 1], f = [];
      const lw = Math.min(o[i], c[i]) - l[i], uw = h[i] - Math.max(o[i], c[i]);
      if (rv[i] >= 2) f.push('volume spike');
      if (rr[i] > 1.5 && rv[i] >= 1.2 && ((upb && clv[i] > .7) || (!upb && clv[i] < .3))) f.push('genuine ' + (upb ? 'up' : 'down') + ' bar');
      if (rr[i] > 1.5 && rv[i] < .8) f.push('suspect ' + (upb ? 'up' : 'down') + ' bar (low volume)');
      if (rr[i] < .6 && rv[i] >= 1.5) f.push('absorption (narrow bar, heavy volume)');
      if (!upb && rv[i] < .7 && clv[i] >= .5) f.push('no-supply test');
      if (lw >= 2 * body && lw >= .6 * r_) f.push('bull pin');
      if (uw >= 2 * body && uw >= .6 * r_) f.push('bear pin');
      if (f.length) { const s = dm(T[i]) + ': ' + f.join(', '); flags.push(s); if (i >= n - 2) recentF.push(s); }
    }
    const lastf = recentF.join(' ');
    for (const [key, x] of [['genuine up', 1], ['no-supply test', 1], ['bull pin', 1], ['genuine down', -1], ['bear pin', -1], ['suspect up', -1], ['suspect down', 1]])
      if (lastf.includes(key)) vote(x, `recent bar: ${key}`);

    // 7 order blocks: last opposite candle before each structure break
    const obs = [];
    for (const e of ev) {
      const bull = e.kind.endsWith('up'), s = e.strong;
      let j = s; for (let q = s; q > Math.max(s - 6, 0); q--) if ((c[q] < o[q]) === bull) { j = q; break; }
      const lo = l[j], hi = h[j], nx = []; for (let q = j + 1; q < Math.min(j + 4, n); q++) nx.push(q);
      let tested = false; for (let q = e.t + 1; q < n; q++) if (bull ? l[q] <= hi : h[q] >= lo) { tested = true; break; }
      const prev = []; for (let q = Math.max(j - 10, 0); q < j; q++) prev.push(q);
      const sweep = bull ? lo < minA(prev.map(q => l[q])) : hi > maxA(prev.map(q => h[q]));
      const imbalance = bull ? minA(nx.map(q => l[q])) > hi : maxA(nx.map(q => h[q])) < lo;
      const volume = rv[j] >= 1.2 || mean(nx.map(q => rv[q])) >= 1.2;
      obs.push({ bull, lo, hi, t: T[j], sweep, imbalance, volume, untested: !tested, score: 1 + sweep + imbalance + volume + !tested });
    }
    let dem = null, sup = null;
    for (const ob of obs) {
      if (ob.bull && ob.untested && ob.hi < c0 && (!dem || ob.hi > dem.hi)) dem = ob;
      if (!ob.bull && ob.untested && ob.lo > c0 && (!sup || ob.lo < sup.lo)) sup = ob;
    }
    let near = null;
    for (const [ob, x] of [[dem, 1], [sup, -1]])
      if (ob && Math.min(Math.abs(c0 - ob.hi), Math.abs(c0 - ob.lo)) <= a0) { near = ob; vote(x, `price within 1 ATR of untested ${x > 0 ? 'demand' : 'supply'} OB ${g5(ob.lo)}-${g5(ob.hi)} (validity ${ob.score}/5)`); }
    if (up && last && gz) vote(1, 'pullback sits in the 50-61.8% zone of the up leg');
    if (!up && last && gz) vote(-1, 'bounce sits in the 50-61.8% zone of the down leg');

    // 8 liquidity: equal highs / lows still untaken (0.25 ATR tolerance)
    function pools(idx, hi) {
      const lv = hi ? h : l, out = [];
      for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
        const i = idx[x], j = idx[y];
        if (Math.abs(lv[i] - lv[j]) <= .25 * a0) {
          let later = hi ? -Infinity : Infinity;
          for (let q = j + 1; q < n; q++) later = hi ? Math.max(later, h[q]) : Math.min(later, l[q]);
          if (hi ? later < Math.max(lv[i], lv[j]) : later > Math.min(lv[i], lv[j])) out.push(hi ? Math.max(lv[i], lv[j]) : Math.min(lv[i], lv[j]));
        }
      }
      return out;
    }
    const pu = pools(S.ph.slice(-12), true).filter(p => p > c0), pd = pools(S.pl.slice(-12), false).filter(p => p < c0);
    const liqUp = pu.length ? Math.min(...pu) : null, liqDn = pd.length ? Math.max(...pd) : null;

    // 9 plan: triggers, stops beyond structure + 0.5 ATR, R:R to the next level
    const shLv = S.sh !== null ? h[S.sh] : maxA(h.slice(-20)), slLv = S.sl !== null ? l[S.sl] : minA(l.slice(-20));
    const above = [sup ? sup.lo : null, liqUp, shLv].filter(x => x && x > c0 * 1.002);
    const below = [dem ? dem.hi : null, liqDn, slLv].filter(x => x && x < c0 * .998);
    const tUp = above.length ? Math.min(...above) : NaN, tDn = below.length ? Math.max(...below) : NaN;
    const stopL = slLv - .5 * a0, stopS = shLv + .5 * a0;
    const rrL = c0 > stopL ? (tUp - c0) / (c0 - stopL) : NaN, rrS = stopS > c0 ? (c0 - tDn) / (stopS - c0) : NaN;
    const net = pts.reduce((s, p) => s + p[0], 0);
    const verdict = net >= 3 ? 'Bullish' : net <= -3 ? 'Bearish' : 'Mixed';
    const atLevel = !!(near || gz);
    return {
      name, date: T[n - 1], close: c0, atr: a0, trend: tr, quality, pullback: pull, strongLevel: strongLv,
      bullTrigger: shLv, bearTrigger: slLv, demand: dem, supply: sup, liqUp, liqDn, targetUp: tUp, targetDn: tDn,
      rrLong: rrL, rrShort: rrS, stopLong: stopL, stopShort: stopS, votes: pts, notes, flags, net, verdict, atLevel,
      location: atLevel ? 'at a level' : 'no key level at price, so wait for location', rsi: R[n - 1], events: ev
    };
  }

  const api = { ema, rma, rsi, atr, macd, relPrior, pivots, structure, scan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Playbook = api;
})(typeof window !== 'undefined' ? window : globalThis);
