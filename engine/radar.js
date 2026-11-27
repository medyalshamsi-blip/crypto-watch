// Radar and simulator engine (no DOM). Candles: d = {t (ms), o, h, l, c, v (quote volume), tb (taker-buy quote volume)}.
const RADAR = (() => {
  const ok = x => x != null && Number.isFinite(x);
  const med = a => { const b = a.filter(x => x > 0).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  const ema = (a, n) => { const k = 2 / (n + 1), o = [a[0]]; for (let i = 1; i < a.length; i++) o.push(a[i] * k + o[i - 1] * (1 - k)); return o; };
  const fmt = x => { const a = Math.abs(x); return a >= 1000 ? x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 1 ? x.toFixed(3) : x.toPrecision(4); };
  function rsi(c, n = 14) { const o = Array(c.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = 100 - 100 / (1 + g / (l || 1e-12)); } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = 100 - 100 / (1 + g / (l || 1e-12)); } } return o; }
  function atr(d, n = 14) { const o = Array(d.c.length).fill(NaN); let a = NaN; for (let i = 1; i < d.c.length; i++) { const tr = Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])); a = i <= n ? (i === 1 ? tr : (a * (i - 1) + tr) / i) : (a * (n - 1) + tr) / n; o[i] = a; } return o; }
  function toHours(m) {                     // 15m candles into 1H candles aligned to the hour (the last one may still be forming)
    const d = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }, cnt = [];
    for (let i = 0; i < m.t.length; i++) {
      const hr = Math.floor(m.t[i] / 3600e3) * 3600e3, j = d.t.length - 1;
      if (j >= 0 && d.t[j] === hr) { d.h[j] = Math.max(d.h[j], m.h[i]); d.l[j] = Math.min(d.l[j], m.l[i]); d.c[j] = m.c[i]; d.v[j] += m.v[i]; d.tb[j] += m.tb[i]; cnt[j]++; }
      else { d.t.push(hr); d.o.push(m.o[i]); d.h.push(m.h[i]); d.l.push(m.l[i]); d.c.push(m.c[i]); d.v.push(m.v[i]); d.tb.push(m.tb[i]); cnt.push(1); }
    }
    if (cnt.length > 1 && cnt[0] < 4) for (const k in d) d[k].shift();   // a partial first hour
    return d;
  }
  function prep(d, btc) {
    const n = d.c.length, R = rsi(d.c), m12 = ema(d.c, 12), m26 = ema(d.c, 26), mac = m12.map((x, i) => x - m26[i]), sig = ema(mac, 9), A = atr(d);
    const bmap = btc ? new Map(btc.t.map((t, i) => [t, i])) : null, bA = btc ? atr(btc) : null;
    const swH = Array(n).fill(NaN), swL = Array(n).fill(NaN); let lh = NaN, ll = NaN;
    for (let i = 0; i < n; i++) { const j = i - 2; if (j >= 2 && d.h[j] > d.h[j - 1] && d.h[j] > d.h[j - 2] && d.h[j] >= d.h[j + 1] && d.h[j] >= d.h[j + 2]) lh = d.h[j]; if (j >= 2 && d.l[j] < d.l[j - 1] && d.l[j] < d.l[j - 2] && d.l[j] <= d.l[j + 1] && d.l[j] <= d.l[j + 2]) ll = d.l[j]; swH[i] = lh; swL[i] = ll; }
    return { d, n, R, mac, sig, A, bmap, btc, bA, swH, swL };
  }
  // the state of bar i in numbers; used by the signals and to find similar moments
  function state(p, i) {
    const { d, R, A } = p, v = d.v, c = d.c; if (i < 60 || !(A[i] > 0)) return null;
    const vm = med(v.slice(i - 24, i)), vb = med(v.slice(i - 48, i - 2));
    let hi = -Infinity, lo = Infinity; for (let q = i - 24; q < i; q++) { hi = Math.max(hi, d.h[q]); lo = Math.min(lo, d.l[q]); }
    let hiP = -Infinity, loP = Infinity; for (let q = i - 25; q < i - 1; q++) { hiP = Math.max(hiP, d.h[q]); loP = Math.min(loP, d.l[q]); }
    const widths = []; for (let q = Math.max(30, i - 200); q < i; q += 4) { let a = -Infinity, b = Infinity; for (let r = q - 24; r < q; r++) { a = Math.max(a, d.h[r]); b = Math.min(b, d.l[r]); } widths.push((a - b) / c[q - 1]); }
    const width = (hi - lo) / c[i - 1], sq = widths.filter(w => w < width).length / Math.max(1, widths.length);
    const sv = v[i] + v[i - 1] + v[i - 2] + v[i - 3], tb4 = sv > 0 ? (d.tb[i] + d.tb[i - 1] + d.tb[i - 2] + d.tb[i - 3]) / sv : .5;
    const ap = A[i] / c[i], r1 = c[i] / c[i - 1] - 1, r4 = c[i] / c[i - 4] - 1, r12 = c[i] / c[i - 12] - 1;
    let rs = NaN, bz = NaN;
    if (p.bmap) { const j = p.bmap.get(d.t[i]), j12 = p.bmap.get(d.t[i - 12]); if (j != null && j12 != null) { const br = p.btc.c[j] / p.btc.c[j12] - 1; rs = r12 - br; bz = br / (p.bA[j] / p.btc.c[j]); } }
    return { volR: v[i] / vm, vol3: (v[i] + v[i - 1] + v[i - 2]) / 3 / vb, tb4, hi, lo, hiP, loP, sq, ap, r1, r4, r12, rs, bz, rsi: R[i], pos: hi > lo ? (c[i] - lo) / (hi - lo) : .5 };
  }
  // signals on closed bar i; null when nothing fired
  function at(p, i) {
    const s0 = state(p, i); if (!s0) return null;
    const { d, R, mac, sig } = p, c = d.c, { volR, vol3, tb4, hi, lo, hiP, loP, sq, ap, r1, r4, rs } = s0;
    const s = [], add = (k, up, w, txt) => s.push({ k, up, w, txt });
    if (volR >= 3 && Math.abs(r1) >= .5 * ap) add('vol', r1 > 0, Math.min(4, 1 + Math.log2(volR)), `volume ${volR.toFixed(1)}× normal on a ${r1 > 0 ? 'green' : 'red'} candle`);
    if (c[i] > hi && c[i - 1] <= hiP && volR >= 1.5) add('brk', true, 3, `broke the ${fmt(hi)} high of the last 24 bars`);
    if (c[i] < lo && c[i - 1] >= loP && volR >= 1.5) add('brk', false, 3, `broke the ${fmt(lo)} low of the last 24 bars`);
    if (ok(p.swH[i]) && c[i] > p.swH[i] && c[i - 1] <= p.swH[i - 1]) add('struct', true, 2, `closed above the swing high ${fmt(p.swH[i])}`);
    if (ok(p.swL[i]) && c[i] < p.swL[i] && c[i - 1] >= p.swL[i - 1]) add('struct', false, 2, `closed below the swing low ${fmt(p.swL[i])}`);
    if (R[i - 1] < 50 && R[i] >= 50) add('mom', true, 1, 'RSI crossed above 50'); else if (R[i - 1] > 50 && R[i] <= 50) add('mom', false, 1, 'RSI crossed below 50');
    if (R[i - 1] <= 30 && R[i] > 30) add('mom', true, 1, 'RSI left oversold'); else if (R[i - 1] >= 70 && R[i] < 70) add('mom', false, 1, 'RSI left overbought');
    if (mac[i - 1] <= sig[i - 1] && mac[i] > sig[i]) add('mom', true, 1, 'MACD crossed up'); else if (mac[i - 1] >= sig[i - 1] && mac[i] < sig[i]) add('mom', false, 1, 'MACD crossed down');
    if (vol3 >= 1.6 && tb4 >= .58 && sq <= .25 && Math.abs(r4) < 2 * ap) add('early', true, 2, `quiet build-up: volume ${vol3.toFixed(1)}× for 3 bars, ${Math.round(tb4 * 100)}% taker buys, tight range`);
    if (!s.length) return null;
    const bull = s.filter(x => x.up).reduce((a, x) => a + x.w, 0), bear = s.filter(x => !x.up).reduce((a, x) => a + x.w, 0), up = bull >= bear;
    let score = Math.abs(bull - bear);
    if (up && ok(rs) && rs > 0) score += .5; if (!up && ok(rs) && rs < 0) score += .5;
    if (up && tb4 >= .55) score += .5; if (!up && tb4 <= .45) score += .5;
    return Object.assign({ i, t: d.t[i], up, score, sig: s, price: c[i] }, s0);
  }
  function after(d, i, H) { if (i + H >= d.c.length) return null; let mx = -Infinity, mn = Infinity; for (let q = i + 1; q <= i + H; q++) { mx = Math.max(mx, d.h[q]); mn = Math.min(mn, d.l[q]); } const c0 = d.c[i]; return { up: mx / c0 - 1, dn: mn / c0 - 1, close: d.c[i + H] / c0 - 1 }; }

  // ---- similar moments: feature vectors with what happened next (log moves in ATR units, step by step)
  const NF = 11, H6 = 6;
  function vec(s) {
    const cl = (x, a) => Math.max(-a, Math.min(a, x));
    return [cl(Math.log(Math.max(s.volR, .05)), 3), cl(Math.log(Math.max(s.vol3, .05)), 3), (s.tb4 - .5) * 6, cl(s.r1 / s.ap, 6), cl(s.r4 / s.ap, 8), cl(s.r12 / s.ap, 12) / 2, (s.rsi - 50) / 12, (s.sq - .5) * 3, ok(s.rs) ? cl(s.rs / s.ap, 12) / 2 : 0, ok(s.bz) ? cl(s.bz, 12) / 2 : 0, (s.pos - .5) * 3];
  }
  function pathAfter(d, i, ap) {          // per step: close move, high and low relative to the step's start, in ATR units of bar i
    if (i + H6 >= d.c.length) return null; const u = Math.log(1 + ap), o = new Float32Array(H6 * 3); let x0 = Math.log(d.c[i]);
    for (let h = 0; h < H6; h++) { const q = i + 1 + h, xc = Math.log(d.c[q]); o[h * 3] = (xc - x0) / u; o[h * 3 + 1] = (Math.log(d.h[q]) - x0) / u; o[h * 3 + 2] = (Math.log(d.l[q]) - x0) / u; x0 = xc; }
    return o;
  }
  // pool of past moments from many coins (and the coin's own history): features + paths; only bars whose next 6 bars are closed
  function addToPool(pool, d, btc, tag) {
    const p = prep(d, btc), n = d.c.length;
    for (let i = 60; i < n - 1 - H6; i++) { const s = state(p, i); if (!s) continue; const ph = pathAfter(d, i, s.ap); if (!ph) continue; pool.X.push(vec(s)); pool.P.push(ph); pool.tag.push(tag); pool.t.push(d.t[i]); }
    return pool;
  }
  const newPool = () => ({ X: [], P: [], tag: [], t: [] });
  function nearest(pool, q, k, skipTag, before) {   // the k most similar moments; optionally leaving one coin out, or only moments known before a time
    const best = []; let worst = Infinity;
    for (let j = 0; j < pool.X.length; j++) {
      if ((skipTag != null && pool.tag[j] === skipTag) || (before != null && pool.t[j] > before)) continue;
      const x = pool.X[j]; let s = 0; for (let f = 0; f < NF && s < worst; f++) { const e = x[f] - q[f]; s += e * e; }
      if (best.length < k) { best.push([s, j]); if (best.length === k) { best.sort((a, b) => a[0] - b[0]); worst = best[k - 1][0]; } }
      else if (s < worst) { let lo = 0, hi = k - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (best[m][0] < s) lo = m + 1; else hi = m; } best.splice(lo, 0, [s, j]); best.pop(); worst = best[k - 1][0]; }
    }
    if (best.length < k) best.sort((a, b) => a[0] - b[0]);
    return best.map(([s, j]) => ({ j, d: Math.sqrt(s) }));
  }
  function rnd(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function neutralSteps(d, upto) {          // the coin's own recent bars, average move removed, in ATR units of the last bar
    const A = atr(d), u = Math.log(1 + A[upto] / d.c[upto]), lo = Math.max(1, upto - 499), out = [];
    for (let i = lo; i <= upto; i++) { const x0 = Math.log(d.c[i - 1]); out.push([(Math.log(d.c[i]) - x0) / u, (Math.log(d.h[i]) - x0) / u, (Math.log(d.l[i]) - x0) / u]); }
    const m = out.reduce((a, r) => a + r[0], 0) / out.length; return out.map(r => [r[0] - m, r[1] - m, r[2] - m]);
  }
  // 20,000+ paths from the coin's own recent bars (average move removed), with up moves and down moves scaled by how far
  // the most similar past moments (across the market and in the coin's own history) actually travelled over the next 6 bars
  function simulate(opt) {
    const { pool, q, steps, N = 20000, K = 300, seed = 1, skipTag, own, before, ownBefore } = opt, rand = rnd(seed), S = steps.length;
    let nb = pool && pool.X.length ? nearest(pool, q, K, skipTag, before).map(x => ({ d: x.d, P: pool.P[x.j], t: pool.t[x.j], tag: pool.tag[x.j] })) : [];
    if (own && own.X.length) nb = nb.concat(nearest(own, q, Math.min(100, own.X.length), null, ownBefore).map(x => ({ d: x.d, P: own.P[x.j], t: own.t[x.j], own: true })));
    const h0 = nb.length ? (nb.reduce((s, x) => s + x.d, 0) / nb.length || 1) : 1, am = [], an = [];
    for (const x of nb) { const P = x.P; let c = 0, mx = 0, mn = 0; for (let h = 0; h < H6; h++) { mx = Math.max(mx, c + P[h * 3 + 1]); mn = Math.min(mn, c + P[h * 3 + 2]); c += P[h * 3]; } const w = Math.exp(-((x.d / h0) ** 2)) * (x.own ? 1.5 : 1); am.push([mx, w]); an.push([-mn, w]); x.up = mx; x.dn = -mn; x.end = c; }
    const wmed = a => { const s = [...a].sort((x, y) => x[0] - y[0]), W = s.reduce((t, x) => t + x[1], 0); let acc = 0; for (const x of s) { acc += x[1]; if (acc >= W / 2) return x[0]; } return NaN; };
    const nm = [], nn = []; for (let r = 0; r < 1000; r++) { let c = 0, mx = 0, mn = 0, s0 = Math.floor(rand() * (S - H6)); for (let h = 0; h < H6; h++) { const st = steps[s0 + h]; mx = Math.max(mx, c + st[1]); mn = Math.min(mn, c + st[2]); c += st[0]; } nm.push(mx); nn.push(-mn); }
    const md = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }, cl = x => Math.max(.5, Math.min(4, x));
    const su = nb.length >= 30 ? cl(wmed(am) / md(nm)) : 1, sd = nb.length >= 30 ? cl(wmed(an) / md(nn)) : 1;
    const HI = new Float32Array(N * H6), LO = new Float32Array(N * H6), CL = new Float32Array(N * H6), MX = new Float32Array(N), MN = new Float32Array(N);
    for (let p = 0; p < N; p++) {
      let x = 0, mx = 0, mn = 0, s0 = Math.floor(rand() * (S - 2)), bi = 0;
      for (let h = 0; h < H6; h++) {
        if (bi === 3) { s0 = Math.floor(rand() * (S - 2)); bi = 0; } const st = steps[Math.min(S - 1, s0 + bi++)];
        const dc = st[0] > 0 ? st[0] * su : st[0] * sd, dh = Math.max(st[1] - Math.max(0, st[0]), 0) * su, dl = Math.max(Math.min(0, st[0]) - st[2], 0) * sd;
        const hiS = Math.max(x, x + dc) + dh, loS = Math.min(x, x + dc) - dl; x += dc;
        mx = Math.max(mx, hiS); mn = Math.min(mn, loS); HI[p * H6 + h] = mx; LO[p * H6 + h] = mn; CL[p * H6 + h] = x;
      }
      MX[p] = mx; MN[p] = mn;
    }
    const pick = (arr, h, f) => { const col = new Float32Array(N); for (let p = 0; p < N; p++) col[p] = arr[p * H6 + h]; col.sort(); return col[Math.min(N - 1, Math.floor(f * N))]; };
    const band = []; for (let h = 0; h < H6; h++) band.push({ hi50: pick(HI, h, .5), hi90: pick(HI, h, .9), lo50: pick(LO, h, .5), lo10: pick(LO, h, .1), c10: pick(CL, h, .1), c50: pick(CL, h, .5), c90: pick(CL, h, .9) });
    const MXs = Float32Array.from(MX).sort(), MNs = Float32Array.from(MN).sort(), qq = (A, f) => A[Math.min(N - 1, Math.floor(f * N))];
    let upC = 0; for (let p = 0; p < N; p++) if (CL[p * H6 + H6 - 1] > 0) upC++;
    const upFirst = nb.length ? nb.filter(x => x.end > 0).length / nb.length : NaN;
    return { N, band, high: { p10: qq(MXs, .1), p50: qq(MXs, .5), p90: qq(MXs, .9) }, low: { p10: qq(MNs, .1), p50: qq(MNs, .5), p90: qq(MNs, .9) }, upClose: upC / N, MX: MXs, MN: MNs, su, sd, analogs: nb.length, ownAnalogs: nb.filter(x => x.own).length, analogsUp: upFirst, neighbours: nb };
  }
  // walk-forward check on the coin's own last bars: did the real 6-bar high and low land inside the predicted 80% ranges?
  function calibrate(opt) {
    const { pool, d, btc, tag, tfMs, tests = 60, N = 1000 } = opt, p = prep(d, btc), n = d.c.length, own = newPool(), res = { market: [0, 0, 0], neutral: [0, 0, 0] };
    addToPool(own, d, btc, tag); let k = 0;
    for (let i = Math.max(120, n - 2 - H6 - tests); i < n - 1 - H6; i++) {
      const s = state(p, i); if (!s) continue; const q = vec(s), steps = neutralSteps(d, i), u = Math.log(1 + s.ap);
      let mx = -Infinity, mn = Infinity; for (let j = i + 1; j <= i + H6; j++) { mx = Math.max(mx, d.h[j]); mn = Math.min(mn, d.l[j]); }
      const zx = Math.log(mx / d.c[i]) / u, zn = Math.log(mn / d.c[i]) / u, cut = d.t[i] - H6 * tfMs;
      for (const [key, pl, ow] of [['market', pool, own], ['neutral', null, null]]) {
        const r = simulate({ pool: pl, q, steps, N, seed: i, skipTag: tag, own: ow, before: cut, ownBefore: cut });
        const R = res[key]; if (zx >= r.high.p10 && zx <= r.high.p90) R[0]++; if (zn >= r.low.p10 && zn <= r.low.p90) R[1]++; R[2]++;
      }
      k++;
    }
    const f = R => R[2] ? { high: R[0] / R[2], low: R[1] / R[2] } : null;
    return { n: k, market: f(res.market), neutral: f(res.neutral) };
  }
  const touch = (sorted, z, up) => { const n = sorted.length; let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < z) lo = m + 1; else hi = m; } return up ? (n - lo) / n : lo / n; };
  return { ok, med, rsi, atr, toHours, prep, state, at, after, vec, pathAfter, addToPool, newPool, nearest, neutralSteps, simulate, calibrate, touch, rnd, H6, NF };
})();
if (typeof module !== 'undefined') module.exports = RADAR;
