// Two extra radars for the Test tab, shared by the dashboard and the hourly GitHub log.
// Sweep radar: stop hunts at liquidity (swing and equal lows or highs, the prior day's low or high,
//   Wyckoff range edges) that close back inside, plus Wyckoff range breaks (sign of strength or weakness).
// Flow radar: what taker buyers and sellers did against what price did (Binance taker-buy volume).
// Point in time: a hit on bar j uses only candles up to j. Read-only. Not financial advice.
const R2 = (() => {
  const DAY = 864e5;
  const P = {
    sweep: { k: 3, look: 96, buf: 0.05, reclaim: 2, eq: 0.15, deep: 1.5, min: 3 },
    wy: { '15m': [], '1H': [30, 48, 72, 96], '4H': [20, 30, 45, 60], width: 6, touches: 3, trend: 3, dry: 0.7, sos: 1.5 },
    flow: { N: 8, base: 200, z: 2.5, volN: 1.2, hold: 0.3, look: 24, surge: 0.68, surgeVol: 2.5, climaxVol: 4, climaxRange: 2, gap: 4, min: 3 },
    out: { bars: { '15m': 24, '1H': 6, '4H': 6 }, thr: 0.05 }
  };
  const TF_MS = { '15m': 9e5, '1H': 36e5, '4H': 144e5 };

  // ---- helpers
  function atr(m, n, p = 14) {
    const a = new Array(n).fill(NaN); let s = 0;
    for (let i = 1; i < n; i++) {
      const tr = Math.max(m.h[i] - m.l[i], Math.abs(m.h[i] - m.c[i - 1]), Math.abs(m.l[i] - m.c[i - 1]));
      if (i <= p) { s += tr; if (i === p) a[i] = s / p; } else a[i] = (a[i - 1] * (p - 1) + tr) / p;
    }
    return a;
  }
  function rsi(c, n, p = 14) {
    const r = new Array(n).fill(NaN); let g = 0, l = 0;
    for (let i = 1; i < n; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return r;
  }
  const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  // Closed 15m candles into complete 1H (4 each) or 4H (16 each) candles, taker-buy volume kept.
  function agg(m, n, ms) {
    const need = ms / 9e5, d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }, cnt = [];
    for (let i = 0; i < n; i++) {
      const b = Math.floor(m.t[i] / ms) * ms, j = d.t.length - 1, tb = m.tb ? m.tb[i] : NaN;
      if (j >= 0 && d.t[j] === b) { d.h[j] = Math.max(d.h[j], m.h[i]); d.l[j] = Math.min(d.l[j], m.l[i]); d.c[j] = m.c[i]; d.v[j] += m.v[i]; d.tb[j] += tb; cnt[j]++; }
      else { d.t.push(b); d.o.push(m.o[i]); d.h.push(m.h[i]); d.l.push(m.l[i]); d.c.push(m.c[i]); d.v.push(m.v[i]); d.tb.push(tb); cnt.push(1); }
    }
    const keep = cnt.map(x => x === need), out = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] };
    for (let j = 0; j < d.t.length; j++) if (keep[j]) for (const k in out) out[k].push(d[k][j]);
    return out;
  }
  function pivots(m, n, k) {                 // swing points; usable from bar p + k (confirmed)
    const lo = [], hi = [];
    for (let p = k; p < n - k; p++) {
      let isL = true, isH = true;
      for (let i = 1; i <= k && (isL || isH); i++) {
        if (!(m.l[p] < m.l[p - i] && m.l[p] <= m.l[p + i])) isL = false;
        if (!(m.h[p] > m.h[p - i] && m.h[p] >= m.h[p + i])) isH = false;
      }
      if (isL) lo.push({ p, lv: m.l[p], conf: p + k });
      if (isH) hi.push({ p, lv: m.h[p], conf: p + k });
    }
    // first bar after confirmation that trades through the level (the sweep or break bar)
    for (const q of lo) { q.took = Infinity; for (let i = q.conf + 1; i < n; i++) if (m.l[i] < q.lv) { q.took = i; break; } }
    for (const q of hi) { q.took = Infinity; for (let i = q.conf + 1; i < n; i++) if (m.h[i] > q.lv) { q.took = i; break; } }
    return { lo, hi };
  }
  function dayLevels(m, n) {                 // previous UTC day's high and low for every bar
    const dh = {}, dl = {}; for (let i = 0; i < n; i++) { const d = Math.floor(m.t[i] / DAY); dh[d] = Math.max(dh[d] ?? -Infinity, m.h[i]); dl[d] = Math.min(dl[d] ?? Infinity, m.l[i]); }
    const first = Math.floor(m.t[0] / DAY);
    return i => { const d = Math.floor(m.t[i] / DAY) - 1; return d > first ? { hi: dh[d], lo: dl[d] } : null; };
  }
  function candle(m, r) {                    // rejection candles on the reclaim bar (the books' definitions)
    const o = m.o[r], c = m.c[r], h = m.h[r], l = m.l[r], rg = h - l || 1e-12, body = Math.abs(c - o);
    const bullPin = Math.min(o, c) - l >= 2 * body && (c - l) / rg >= 0.66, bearPin = h - Math.max(o, c) >= 2 * body && (h - c) / rg >= 0.66;
    const p = r - 1, bullEng = p >= 0 && c > o && m.c[p] < m.o[p] && o <= m.c[p] && c >= m.o[p], bearEng = p >= 0 && c < o && m.c[p] > m.o[p] && o >= m.c[p] && c <= m.o[p];
    const outside = p >= 0 && h > m.h[p] && l < m.l[p];
    return { bull: bullPin ? 'pin bar' : bullEng ? 'engulfing' : outside && c > (h + l) / 2 ? 'outside bar' : null, bear: bearPin ? 'pin bar' : bearEng ? 'engulfing' : outside && c < (h + l) / 2 ? 'outside bar' : null };
  }

  // ---- Wyckoff trading range ending at bar j (only data up to j)
  function range(m, j, A, tf, o = P.wy) {
    const wins = o[tf] || []; if (!wins.length) return null;
    for (const L of wins.slice().sort((a, b) => b - a)) {
      const s = j - L + 1; if (s < 30 || !(A[j] > 0)) continue;
      let hiC = -Infinity, loC = Infinity, hiH = -Infinity, loL = Infinity;
      for (let i = s; i <= j; i++) { hiC = Math.max(hiC, m.c[i]); loC = Math.min(loC, m.c[i]); hiH = Math.max(hiH, m.h[i]); loL = Math.min(loL, m.l[i]); }
      if ((hiC - loC) / A[j] > o.width) continue;
      const hi = Math.min(hiH, hiC + 0.5 * A[j]), lo = Math.max(loL, loC - 0.5 * A[j]);
      let tu = 0, tl = 0, lu = -9, ll = -9;                       // a trading range is tested at both edges again and again
      for (let i = s; i <= j; i++) { if (m.h[i] >= hi - 0.5 * A[j] && i - lu >= 3) { tu++; lu = i; } if (m.l[i] <= lo + 0.5 * A[j] && i - ll >= 3) { tl++; ll = i; } }
      if (tu < o.touches || tl < o.touches) continue;
      const pre = s - Math.round(L / 2) >= 0 ? (m.c[s] - m.c[s - Math.round(L / 2)]) / A[j] : 0;
      let va = 0, vr = 0; for (let i = s; i <= j; i++) va += m.v[i]; for (let i = Math.max(s, j - 9); i <= j; i++) vr += m.v[i];
      const dry = (vr / Math.min(10, L)) / (va / L);
      return { L, s, lo, hi, phase: pre <= -o.trend ? 'accumulation' : pre >= o.trend ? 'distribution' : 'range', pre, dry: dry <= o.dry, dryX: dry };
    }
    return null;
  }

  // ---- Sweep radar
  function sweeps(m, n, tf, opt = {}) {
    const o = Object.assign({}, P.sweep, opt), A = atr(m, n), R = rsi(m.c, n), pv = pivots(m, n, o.k), prevDay = tf === '4H' ? () => null : dayLevels(m, n);
    const hits = [], seen = new Set(), memo = new Array(n);
    const vMed = j => med(m.v.slice(Math.max(0, j - 20), j)), RG = j => memo[j] === undefined ? (memo[j] = range(m, j, A, tf)) : memo[j];
    const dayLo = new Array(n), dayHi = new Array(n);           // today's low and high before bar j
    for (let i = 0, d = -1, lo = Infinity, hi = -Infinity; i < n; i++) { const dd = Math.floor(m.t[i] / DAY); if (dd !== d) { d = dd; lo = Infinity; hi = -Infinity; } dayLo[i] = lo; dayHi[i] = hi; lo = Math.min(lo, m.l[i]); hi = Math.max(hi, m.h[i]); }
    for (let side of [1, -1]) {
      const pts = side > 0 ? pv.lo : pv.hi, byTook = new Map();
      for (const q of pts) if (q.took < Infinity) { if (!byTook.has(q.took)) byTook.set(q.took, []); byTook.get(q.took).push(q); }
      for (let j = Math.max(30, o.k * 2 + 1); j < n; j++) {
        const a = A[j]; if (!(a > 0)) continue;
        const ext = side > 0 ? m.l[j] : m.h[j];
        // pools swept by bar j: confirmed before j, within the look-back, first traded through on j
        const swept = (byTook.get(j) || []).filter(q => q.conf <= j - 1 && q.p >= j - o.look && (side > 0 ? ext < q.lv - o.buf * a : ext > q.lv + o.buf * a));
        const pd = prevDay(j); let pdl = null;
        if (pd) { const lv = side > 0 ? pd.lo : pd.hi, first = side > 0 ? !(dayLo[j] < lv) : !(dayHi[j] > lv);
          if (first && (side > 0 ? ext < lv - o.buf * a : ext > lv + o.buf * a)) pdl = lv; }
        const rg = RG(j - 1);
        const rangeEdge = rg && (side > 0 ? ext < rg.lo - o.buf * a : ext > rg.hi + o.buf * a) ? (side > 0 ? rg.lo : rg.hi) : null;
        if (!swept.length && pdl == null && rangeEdge == null) continue;
        // the level: the furthest one taken (most stops behind it)
        const cands = swept.map(q => ({ lv: q.lv, what: 'swing', q })).concat(pdl != null ? [{ lv: pdl, what: side > 0 ? 'prior day low' : 'prior day high' }] : []).concat(rangeEdge != null ? [{ lv: rangeEdge, what: side > 0 ? 'range low' : 'range high' }] : []);
        let lvl = cands.reduce((b, x) => !b || (side > 0 ? x.lv < b.lv : x.lv > b.lv) ? x : b, null);
        const pref = cands.find(x => x.what.startsWith('range') && Math.abs(x.lv - lvl.lv) <= 0.15 * a) || cands.find(x => x.what.startsWith('prior') && Math.abs(x.lv - lvl.lv) <= 0.15 * a);
        if (pref) lvl = Object.assign({}, pref, { q: lvl.q || pref.q });   // a range edge or the prior day's level names the pool
        // reclaim: a close back on the right side within `reclaim` bars
        let r = -1; for (let i = j; i <= Math.min(n - 1, j + o.reclaim); i++) { if (side > 0 ? m.c[i] > lvl.lv : m.c[i] < lvl.lv) { r = i; break; } if (i > j && (side > 0 ? m.l[i] < ext : m.h[i] > ext)) break; }
        if (r < 0) continue;
        const key = side + ':' + r; if (seen.has(key)) continue; seen.add(key);
        const eqN = pts.filter(q => q.p >= j - o.look && q.p < j && q.conf <= j - 1 && q.p >= j - o.look && q.took >= j && Math.abs(q.lv - lvl.lv) <= o.eq * a).length;
        const depth = Math.abs(ext - lvl.lv) / a, vm = m.v[j] / (vMed(j) || 1), cd = candle(m, r), cn = side > 0 ? cd.bull : cd.bear;
        const piv = lvl.q || swept[0], div = piv && ok(R[j]) && ok(R[piv.p]) && (side > 0 ? R[j] > R[piv.p] + 2 : R[j] < R[piv.p] - 2);
        const spring = lvl.what.startsWith('range') && rg && (side > 0 ? rg.phase !== 'distribution' : rg.phase !== 'accumulation');
        let s = 2; const tags = [];
        const pool = lvl.what === 'swing' ? (eqN >= 2 ? (side > 0 ? 'equal lows' : 'equal highs') : (side > 0 ? 'swing low' : 'swing high')) : lvl.what;
        if (eqN >= 2 || lvl.what !== 'swing') { s += 1; tags.push(pool + (eqN >= 2 ? ` (${eqN})` : '')); }
        if (cn) { s += 1; tags.push(cn); }
        if (vm >= 2) { s += 1; tags.push(`volume ${vm.toFixed(1)}×`); } else if (vm >= 1.3) { s += 0.5; tags.push(`volume ${vm.toFixed(1)}×`); }
        if (div) { s += 1; tags.push('RSI divergence'); }
        if (spring) { s += 1; tags.push(rg.phase === 'range' ? 'range edge' : rg.phase + ' range'); }
        if (depth <= 0.5) s += 0.5; else if (depth > o.deep) { s -= 1; tags.push('deep'); }
        if (r > j) tags.push('reclaimed after ' + (r - j) + ' bar' + (r - j > 1 ? 's' : ''));
        if (s < o.min) continue;
        const kind = spring ? (side > 0 ? 'spring' : 'upthrust') : 'sweep';
        hits.push({ tf, j: r, t: m.t[r], side, kind, pool, level: lvl.lv, ext, depth: +depth.toFixed(2), score: +Math.min(s, 8).toFixed(1), tags, entry: m.c[r], stop: ext - side * 0.25 * a, phase: rg ? rg.phase : null });
      }
    }
    // Wyckoff range breaks on volume: sign of strength (up) or weakness (down)
    for (let j = 40; j < n; j++) {
      const a = A[j]; if (!(a > 0)) continue;
      const rg = RG(j - 1); if (!rg) continue;
      const vm = m.v[j] / (vMed(j) || 1);
      for (const side of [1, -1]) {
        const lv = side > 0 ? rg.hi : rg.lo;
        if (!(side > 0 ? m.c[j] > lv && m.c[j - 1] <= lv : m.c[j] < lv && m.c[j - 1] >= lv) || vm < P.wy.sos) continue;
        const key = side + ':' + j; if (seen.has(key)) continue; seen.add(key);
        let s = 2.5 + (vm >= 2.5 ? 1 : 0.5) + ((side > 0 && rg.phase === 'accumulation') || (side < 0 && rg.phase === 'distribution') ? 1 : 0) + (rg.dry ? 0.5 : 0);
        const tags = [`${rg.L}-bar ${rg.phase === 'range' ? 'range' : rg.phase + ' range'}`, `volume ${vm.toFixed(1)}×`].concat(rg.dry ? ['volume dried up before'] : []);
        if (s < P.sweep.min) continue;
        hits.push({ tf, j, t: m.t[j], side, kind: side > 0 ? 'sos' : 'sow', pool: side > 0 ? 'range high' : 'range low', level: lv, ext: m.c[j], depth: 0, score: +Math.min(s, 8).toFixed(1), tags, entry: m.c[j], stop: side > 0 ? (rg.lo + rg.hi) / 2 : (rg.lo + rg.hi) / 2, phase: rg.phase });
      }
    }
    return hits.sort((x, y) => x.j - y.j);
  }
  // Current Wyckoff picture on the last closed bar.
  function phase(m, n, tf) { if (n < 40) return null; const A = atr(m, n), rg = range(m, n - 1, A, tf); if (!rg) return null; const px = m.c[n - 1]; return Object.assign({}, rg, { pos: (px - rg.lo) / Math.max(1e-12, rg.hi - rg.lo) }); }

  // ---- Flow radar (needs taker-buy volume)
  function flow(m, n, tf, opt = {}) {
    const o = Object.assign({}, P.flow, opt), hits = [];
    if (!m.tb || !m.tb.length || !(m.tb[n - 1] >= 0)) return hits;
    const A = atr(m, n), N = o.N, ns = new Array(n).fill(NaN);
    let sb = 0, sv = 0; for (let i = 0; i < n; i++) { sb += m.tb[i]; sv += m.v[i]; if (i >= N) { sb -= m.tb[i - N]; sv -= m.v[i - N]; } if (i >= N - 1 && sv > 0) ns[i] = sb / sv; }
    const last = {}, was = { 1: false, '-1': false }, vMed = j => med(m.v.slice(Math.max(0, j - 20), j));
    let s1 = 0, s2 = 0, cnt = 0;
    const lo0 = N - 1;
    for (let j = 0; j < n; j++) {
      // baseline of N-bar taker-buy share over the previous `base` bars, ending N bars back (no overlap with now)
      const add = j - N, rem = j - N - o.base;
      if (add >= lo0 && ok(ns[add])) { s1 += ns[add]; s2 += ns[add] ** 2; cnt++; }
      if (rem >= lo0 && ok(ns[rem])) { s1 -= ns[rem]; s2 -= ns[rem] ** 2; cnt--; }
      if (j < Math.max(60, N + 40) || !(A[j] > 0) || cnt < 40) continue;
      const mu = s1 / cnt, sd = Math.sqrt(Math.max(1e-9, s2 / cnt - mu * mu)), z = (ns[j] - mu) / sd, dP = (m.c[j] - m.c[j - N]) / A[j];
      const sig = { 1: [], '-1': [] }, sc = { 1: 0, '-1': 0 }; let vmC = null; const vmF = () => vmC ?? (vmC = m.v[j] / (vMed(j) || 1));
      let vN = 0, vB = 0; for (let i = j - N + 1; i <= j; i++) vN += m.v[i]; for (let i = Math.max(0, j - N - 40); i <= j - N; i++) vB += m.v[i];
      const busy = vN / N >= o.volN * (vB / Math.min(41, j - N + 1) || 1);   // the takers' push came with real volume
      // absorption: aggressive sellers but price held (bullish), aggressive buyers but price stalled (bearish)
      const onB = busy && z <= -o.z && dP >= -o.hold, onS = busy && z >= o.z && dP <= o.hold, newB = onB && !was[1], newS = onS && !was[-1]; was[1] = onB; was[-1] = onS;   // fire when an episode starts
      if (newB) { sc[1] += 3 + (z <= -3.5 ? 1 : 0); sig[1].push(`hidden buying: taker buys ${(ns[j] * 100).toFixed(0)}% vs usual ${(mu * 100).toFixed(0)}%, price ${dP >= 0 ? 'up' : 'held'} (${dP.toFixed(1)} ATR)`); }
      if (newS) { sc[-1] += 3 + (z >= 3.5 ? 1 : 0); sig[-1].push(`hidden selling: taker buys ${(ns[j] * 100).toFixed(0)}% vs usual ${(mu * 100).toFixed(0)}%, price ${dP <= 0 ? 'down' : 'stalled'} (${dP.toFixed(1)} ATR)`); }
      // CVD divergence at a new low or high
      const L = o.look, s0 = j - 2 * L;
      if (s0 >= 0) {
        let lowNew = true, highNew = true; for (let i = j - L; i < j; i++) { if (m.c[i] <= m.c[j]) lowNew = false; if (m.c[i] >= m.c[j]) highNew = false; }
        if (lowNew || highNew) {
          const cvd = []; let c0 = 0, vs = 0; for (let i = s0; i <= j; i++) { c0 += 2 * m.tb[i] - m.v[i]; vs += m.v[i]; cvd.push(c0); }
          let p = -1; for (let i = s0; i <= j - L / 2; i++) if (p < 0 || (lowNew ? m.c[i] < m.c[p] : m.c[i] > m.c[p])) p = i;
          const margin = 0.05 * vs, dv = cvd[j - s0] - cvd[p - s0];
          if (lowNew && m.c[j] < m.c[p] && dv > margin) { sc[1] += 2.5; sig[1].push('price at a new low, buyers stronger than at the last low (CVD divergence)'); }
          if (highNew && m.c[j] > m.c[p] && dv < -margin) { sc[-1] += 2.5; sig[-1].push('price at a new high, buyers weaker than at the last high (CVD divergence)'); }
        }
      }
      // surge: one bar dominated by takers on heavy volume, closing with them
      const sh = m.v[j] > 0 ? m.tb[j] / m.v[j] : 0.5, rg = m.h[j] - m.l[j] || 1e-12, pos = (m.c[j] - m.l[j]) / rg;
      if (sh >= o.surge && m.c[j] > m.o[j] && pos >= 0.6 && vmF() >= o.surgeVol) { const vm = vmF(); sc[1] += 2 + (vm >= 4 ? 1 : 0); sig[1].push(`buyer surge: ${(sh * 100).toFixed(0)}% taker buys on ${vm.toFixed(1)}× volume`); }
      if (sh <= 1 - o.surge && m.c[j] < m.o[j] && pos <= 0.4 && vmF() >= o.surgeVol) { const vm = vmF(); sc[-1] += 2 + (vm >= 4 ? 1 : 0); sig[-1].push(`seller surge: ${((1 - sh) * 100).toFixed(0)}% taker sells on ${vm.toFixed(1)}× volume`); }
      // climax: huge bar that closes away from its extreme against the takers
      if (rg >= o.climaxRange * A[j] && vmF() >= o.climaxVol) { const vm = vmF();
        if (m.c[j] < m.o[j] || sh < 0.45) { if (pos >= 0.5) { sc[1] += 3; sig[1].push(`selling climax: ${vm.toFixed(1)}× volume, closed off the low`); } }
        if (m.c[j] > m.o[j] || sh > 0.55) { if (pos <= 0.5) { sc[-1] += 3; sig[-1].push(`buying climax: ${vm.toFixed(1)}× volume, closed off the high`); } }
      }
      for (const side of [1, -1]) {
        const s = sc[side]; if (s < o.min) continue;
        if (last[side] != null && j - last[side] < o.gap) continue;
        last[side] = j;
        const kind = sig[side][0].split(':')[0].replace(/^price at a new (low|high).*/, 'CVD divergence');
        hits.push({ tf, j, t: m.t[j], side, kind, score: +Math.min(s, 8).toFixed(1), tags: sig[side], z: +z.toFixed(2), share: +ns[j].toFixed(3), usual: +mu.toFixed(3), entry: m.c[j], stop: side > 0 ? Math.min(...m.l.slice(j - 3, j + 1)) - 0.25 * A[j] : Math.max(...m.h.slice(j - 3, j + 1)) + 0.25 * A[j] });
      }
    }
    return hits;
  }
  const ok = x => typeof x === 'number' && isFinite(x);

  // ---- what happened after a bar: 5% up or down first, and the close after the window
  function outcome(m, n, j, tf, o = P.out) {
    const bars = o.bars[tf] || 6, end = Math.min(n - 1, j + bars), c = m.c[j]; if (end <= j) return null;
    let up = 0, dn = 0, first = 0;
    for (let i = j + 1; i <= end; i++) { const u = m.h[i] / c - 1, d = m.l[i] / c - 1; if (!first) { if (u >= o.thr && d <= -o.thr) first = 2; else if (u >= o.thr) first = 1; else if (d <= -o.thr) first = -1; } up = Math.max(up, u); dn = Math.min(dn, d); }
    return { up, dn, up5: up >= o.thr, dn5: dn <= -o.thr, first, ret: m.c[end] / c - 1, done: j + bars <= n - 1 };
  }
  // Track record over the loaded candles: hits against every bar of the same coins (the base rate).
  function track(sets, minScore = 3) {    // sets: [{ m, n, tf, hits }]
    const z = () => ({ n: 0, up5: 0, dn5: 0, upFirst: 0, dnFirst: 0, closeUp: 0 });
    const res = { bull: z(), bear: z(), base: z() }, addTo = (b, oc) => { b.n++; if (oc.up5) b.up5++; if (oc.dn5) b.dn5++; if (oc.first === 1) b.upFirst++; if (oc.first === -1) b.dnFirst++; if (oc.ret > 0) b.closeUp++; };
    for (const { m, n, tf, hits } of sets) {
      const step = tf === '15m' ? 4 : 1;
      for (let j = 60; j < n; j += step) { const oc = outcome(m, n, j, tf); if (oc && oc.done) addTo(res.base, oc); }
      for (const h of hits) { if (h.score < minScore) continue; const oc = outcome(m, n, h.j, tf); if (oc && oc.done) addTo(h.side > 0 ? res.bull : res.bear, oc); }
    }
    const pct = (b, k) => b.n ? +(100 * b[k] / b.n).toFixed(1) : null;
    for (const k of ['bull', 'bear', 'base']) { const b = res[k]; Object.assign(b, { up5Pct: pct(b, 'up5'), dn5Pct: pct(b, 'dn5'), closeUpPct: pct(b, 'closeUp'), upFirstPct: pct(b, 'upFirst'), dnFirstPct: pct(b, 'dnFirst') }); }
    return res;
  }
  // All hits for one coin from its closed 15m candles.
  function scan(m15, n, opt = {}) {
    const h1 = agg(m15, n, 36e5), h4 = agg(m15, n, 144e5), out = { h1, h4, sweep: [], flow: [], phase: {} };
    const tfs = [['15m', m15, n], ['1H', h1, h1.t.length], ['4H', h4, h4.t.length]];
    for (const [tf, m, k] of tfs) {
      if (k < 60) continue;
      if (!opt.only || opt.only === 'sweep') out.sweep.push(...sweeps(m, k, tf));
      if (tf !== '4H' && (!opt.only || opt.only === 'flow')) out.flow.push(...flow(m, k, tf));
      if (tf !== '15m') out.phase[tf] = phase(m, k, tf);
    }
    return out;
  }
  const KIND = { sweep: 'Sweep & reclaim', spring: 'Spring', upthrust: 'Upthrust', sos: 'Sign of strength', sow: 'Sign of weakness', 'hidden buying': 'Hidden buying', 'hidden selling': 'Hidden selling', 'CVD divergence': 'CVD divergence', 'buyer surge': 'Buyer surge', 'seller surge': 'Seller surge', 'selling climax': 'Selling climax', 'buying climax': 'Buying climax' };
  return { P, TF_MS, atr, rsi, agg, pivots, range, sweeps, phase, flow, outcome, track, scan, KIND };
})();
if (typeof module !== 'undefined') module.exports = R2;
