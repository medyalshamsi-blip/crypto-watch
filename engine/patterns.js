// Chart patterns (playbook §8) and candle rejections at levels (playbook §3 and §5), for the chart and its tests.
// Patterns: ascending, descending, symmetrical and expanding triangles, rising and falling wedges, rectangles,
// flags and pennants, double and triple tops and bottoms, head and shoulders and the inverse.
// Rules: confirmation is a close beyond the boundary; volume should contract inside and expand on the break;
// the target is 100% of the pattern height from the break (80% shown as the take-profit), and strong levels override it.
// Only closed candles; a pattern is judged with the candles up to the bar being read. Not financial advice.
const PAT = (() => {
  const P = { k: 3, win: 160, minLen: 15, minH: 1.5, flat: 0.02, conv: 0.75, exp: 1.3, tol: 0.35, inside: 0.3, brkVol: 1.5, peakTol: 0.6, depth: 2, trend: 3 };
  const ok = x => typeof x === 'number' && isFinite(x);
  function atr(m, n, p = 14) { const a = new Array(n).fill(NaN); let s = 0; for (let i = 1; i < n; i++) { const tr = Math.max(m.h[i] - m.l[i], Math.abs(m.h[i] - m.c[i - 1]), Math.abs(m.l[i] - m.c[i - 1])); if (i <= p) { s += tr; if (i === p) a[i] = s / p; } else a[i] = (a[i - 1] * (p - 1) + tr) / p; } for (let i = 0; i < Math.min(p, n); i++) a[i] = a[Math.min(p, n - 1)]; return a; }
  function pivots(m, n, k) { const lo = [], hi = []; for (let p = k; p < n - k; p++) { let L = true, H = true; for (let i = 1; i <= k; i++) { if (!(m.l[p] < m.l[p - i] && m.l[p] <= m.l[p + i])) L = false; if (!(m.h[p] > m.h[p - i] && m.h[p] >= m.h[p + i])) H = false; } if (L) lo.push({ p, v: m.l[p] }); if (H) hi.push({ p, v: m.h[p] }); } return { lo, hi }; }
  function fit(pts) { const n = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const q of pts) { sx += q.p; sy += q.v; sxx += q.p * q.p; sxy += q.p * q.v; } const d = n * sxx - sx * sx, b = d ? (n * sxy - sx * sy) / d : 0, a = (sy - b * sx) / n; return { a, b, at: i => a + b * i }; }
  const avg = (a, i0, i1) => { let s = 0, c = 0; for (let i = Math.max(0, i0); i <= i1; i++) { s += a[i]; c++; } return c ? s / c : NaN; };
  const NAME = { asc: 'Ascending triangle', desc: 'Descending triangle', sym: 'Symmetrical triangle', exp: 'Expanding triangle', rwedge: 'Rising wedge', fwedge: 'Falling wedge', rect: 'Rectangle', bflag: 'Bull flag', bpenn: 'Bull pennant', sflag: 'Bear flag', spenn: 'Bear pennant', dtop: 'Double top', dbot: 'Double bottom', ttop: 'Triple top', tbot: 'Triple bottom', hs: 'Head and shoulders', ihs: 'Inverse head and shoulders' };
  const BIAS = { asc: 1, desc: -1, sym: 0, exp: 0, rwedge: -1, fwedge: 1, rect: 0, bflag: 1, bpenn: 1, sflag: -1, spenn: -1, dtop: -1, dbot: 1, ttop: -1, tbot: 1, hs: -1, ihs: 1 };

  // break of a boundary after `from`: first close beyond, then whether a later close went back inside
  function breakOf(m, n, from, up, lo, A) {
    for (let i = from + 1; i < n; i++) {
      const u = up(i), l = lo(i);
      if (m.c[i] > u) { let fail = -1; for (let k = i + 1; k < n; k++) if (m.c[k] < up(k)) { fail = k; break; } return { i, dir: 1, at: u, fail }; }
      if (m.c[i] < l) { let fail = -1; for (let k = i + 1; k < n; k++) if (m.c[k] > lo(k)) { fail = k; break; } return { i, dir: -1, at: l, fail }; }
    }
    return null;
  }
  function volRead(m, s0, s1, bi) {
    const half = Math.floor((s0 + s1) / 2), a = avg(m.v, s0, half), b = avg(m.v, half + 1, s1), inside = avg(m.v, s0, s1);
    return { contracted: b < a, brkX: bi != null ? m.v[bi] / inside : null };
  }
  function finish(p, m, n, A, o) {          // status, entry, stop, target, R:R and the notes in words
    const b = p.brk, a = A[n - 1];
    p.status = !b ? 'forming' : b.fail >= 0 ? 'failed' : 'confirmed';
    p.bias = BIAS[p.type]; p.name = NAME[p.type];
    if (b) {
      p.dir = b.dir; p.entry = m.c[b.i]; p.against = p.bias && p.bias !== b.dir;
      if (p.target == null) p.target = b.at + b.dir * p.height;
      p.target80 = p.entry + 0.8 * (p.target - p.entry);
      if (p.stop == null) p.stop = b.at - b.dir * 0.25 * a;
      p.rr = Math.abs(p.target80 - p.entry) / Math.max(1e-12, Math.abs(p.entry - p.stop));
      p.volOk = p.vol && p.vol.brkX >= o.brkVol;
    }
    const v = p.vol ? (p.vol.contracted ? 'volume contracted inside' : 'volume did not contract') + (p.vol.brkX != null ? `, break bar ${p.vol.brkX.toFixed(1)}× the pattern's volume` : '') : '';
    p.note = [v, p.against ? 'broke against the usual bias' : '', p.extra || ''].filter(Boolean).join('; ');
    return p;
  }

  // triangles, wedges, rectangles: lines through the last swing highs and lows
  function lines(m, n, A, pv, o) {
    const out = [], e = n - 1, a = A[e];
    const H = pv.hi.filter(q => q.p >= e - o.win && q.p + o.k <= e), L = pv.lo.filter(q => q.p >= e - o.win && q.p + o.k <= e);
    let best = null;
    for (let nh = 2; nh <= Math.min(4, H.length); nh++) for (let nl = 2; nl <= Math.min(4, L.length); nl++) {
      const hp = H.slice(-nh), lp = L.slice(-nl), s0 = Math.min(hp[0].p, lp[0].p), s1 = Math.max(hp[nh - 1].p, lp[nl - 1].p);
      if (s1 - s0 < o.minLen) continue;
      const up = fit(hp), lo = fit(lp);
      if (hp.some(q => Math.abs(q.v - up.at(q.p)) > o.tol * a) || lp.some(q => Math.abs(q.v - lo.at(q.p)) > o.tol * a)) continue;
      const hs = up.at(s0) - lo.at(s0), he = up.at(s1) - lo.at(s1); if (!(hs > 0 && he > 0) || Math.max(hs, he) < o.minH * a) continue;
      let inside = true; for (let i = s0; i <= s1 && inside; i++) if (m.c[i] > up.at(i) + o.inside * a || m.c[i] < lo.at(i) - o.inside * a) inside = false;
      if (!inside) continue;
      const su = up.b / a, sl = lo.b / a, flatU = Math.abs(su) <= o.flat, flatL = Math.abs(sl) <= o.flat, conv = he < o.conv * hs, expd = he > o.exp * hs;
      let type = null;
      if (conv && flatU && sl > o.flat) type = 'asc';
      else if (conv && flatL && su < -o.flat) type = 'desc';
      else if (conv && su < -o.flat && sl > o.flat) type = 'sym';
      else if (conv && su > o.flat && sl > su) type = 'rwedge';
      else if (conv && sl < -o.flat && su < sl) type = 'fwedge';
      else if (flatU && flatL && !conv && !expd && nh + nl >= 4) type = 'rect';
      else if (expd && su > o.flat && sl < -o.flat) type = 'exp';
      if (!type) continue;
      // a triangle or wedge that ran past its apex without breaking is over
      if (conv && up.b !== lo.b) { const apex = (lo.a - up.a) / (up.b - lo.b); if (apex < e - 3 && !breakOf(m, Math.min(n, Math.ceil(apex) + 1), s1, up.at, lo.at, A)) continue; }
      const touches = nh + nl;
      if (!best || touches > best.touches || (touches === best.touches && s1 > best.s1)) best = { type, s0, s1, up, lo, hs, he, touches, nh, nl };
    }
    if (!best) return out;
    const { type, s0, s1, up, lo, hs } = best, brk = type === 'exp' ? null : breakOf(m, n, s1, up.at, lo.at, A);
    const p = { type, from: s0, to: brk ? brk.i : e, brk, height: hs, touches: best.touches, vol: volRead(m, s0, s1, brk && brk.i), lines: [{ i0: s0, v0: up.at(s0), i1: brk ? brk.i : e, v1: up.at(brk ? brk.i : e) }, { i0: s0, v0: lo.at(s0), i1: brk ? brk.i : e, v1: lo.at(brk ? brk.i : e) }] };
    if (brk && (type === 'rwedge' || type === 'fwedge')) {         // wedge targets: T1 the last swing inside, T2 the wedge start
      const inside = brk.dir < 0 ? pv.lo.filter(q => q.p >= s0 && q.p <= s1) : pv.hi.filter(q => q.p >= s0 && q.p <= s1);
      p.target = inside.length ? inside[inside.length - 1].v : brk.at + brk.dir * hs; p.target2 = brk.dir < 0 ? lo.at(s0) : up.at(s0);
      if (Math.sign(p.target - m.c[brk.i]) !== brk.dir) p.target = p.target2;
      p.stop = brk.dir < 0 ? Math.max(...m.h.slice(Math.max(0, brk.i - 2), brk.i + 1)) + 0.1 * a : Math.min(...m.l.slice(Math.max(0, brk.i - 2), brk.i + 1)) - 0.1 * a;
    }
    if (brk && type === 'sym') p.stop = brk.dir > 0 ? lo.at(brk.i) : up.at(brk.i);
    if (type === 'exp') p.extra = `trade the edges: lower line ${up.at(e) > lo.at(e) ? lo.at(e).toPrecision(5) : ''}, upper line ${up.at(e).toPrecision(5)}`;
    out.push(finish(p, m, n, A, o));
    return out;
  }

  // flags and pennants: an impulsive pole, then a small counter-move
  function flags(m, n, A, o) {
    const out = [], e = n - 1;
    for (let pt = e - 5; pt >= Math.max(15, e - 30); pt--) {
      for (const dir of [1, -1]) {
        let found = null;
        for (let ps = pt - 3; ps >= Math.max(1, pt - 12); ps--) {
          const a = A[pt], pole = dir > 0 ? m.h[pt] - m.l[ps] : m.h[ps] - m.l[pt], net = dir * (m.c[pt] - m.c[ps]);
          if (pole >= 4 * a && net >= 3 * a) { found = { ps, pole }; break; }
        }
        if (!found) continue;
        const { ps, pole } = found, top = dir > 0 ? m.h[pt] : m.l[pt];
        // the pole must be the extreme: nothing beyond it after
        let ext = true, deep = true;   // ext: nothing went beyond the pole's end afterwards
        for (let i = pt + 1; i <= e; i++) { if (dir > 0 ? m.h[i] > top : m.l[i] < top) { ext = false; break; } }
        const fl = []; for (let i = pt + 1; i <= e; i++) fl.push(i);
        if (fl.length < 4) continue;
        // flag body: up to the break (a close beyond the flag's far line) or now
        const hiP = fl.map(i => ({ p: i, v: m.h[i] })), loP = fl.map(i => ({ p: i, v: m.l[i] }));
        let brk = null, endF = e;
        for (let k = 4; k <= fl.length; k++) {
          const i = fl[k - 1], U = fit(hiP.slice(0, k - 1)), Lw = fit(loP.slice(0, k - 1));
          if (k > 4 && (dir > 0 ? m.c[i] > U.at(i) : m.c[i] < Lw.at(i))) { brk = { i, dir, at: dir > 0 ? U.at(i) : Lw.at(i) }; endF = i - 1; break; }
        }
        if (!brk && !ext) continue;
        const body = fl.filter(i => i <= endF); if (body.length < 4 || body.length > 25) continue;
        const retr = dir > 0 ? top - Math.min(...body.map(i => m.l[i])) : Math.max(...body.map(i => m.h[i])) - top; if (retr > 0.5 * pole) deep = false;
        if (!deep) continue;
        const U = fit(body.map(i => ({ p: i, v: m.h[i] }))), Lw = fit(body.map(i => ({ p: i, v: m.l[i] }))), a = A[pt];
        const su = U.b / a, sl = Lw.b / a, h0 = U.at(body[0]) - Lw.at(body[0]), h1 = U.at(body[body.length - 1]) - Lw.at(body[body.length - 1]);
        const pennant = h1 < 0.6 * h0, against = dir > 0 ? su <= 0.02 && sl <= 0.02 : su >= -0.02 && sl >= -0.02;
        if (!pennant && !against) continue;
        const pv = avg(m.v, ps, pt), fv = avg(m.v, body[0], body[body.length - 1]);
        if (brk) { let fail = -1; for (let k = brk.i + 1; k < n; k++) if (dir > 0 ? m.c[k] < Lw.at(k) : m.c[k] > U.at(k)) { fail = k; break; } brk.fail = fail; }
        const type = dir > 0 ? (pennant ? 'bpenn' : 'bflag') : (pennant ? 'spenn' : 'sflag');
        const p = { type, from: ps, to: brk ? brk.i : e, brk, height: pole, pole: { i0: ps, v0: dir > 0 ? m.l[ps] : m.h[ps], i1: pt, v1: top }, touches: body.length,
          vol: { contracted: fv < pv, brkX: brk ? m.v[brk.i] / fv : null }, lines: [{ i0: body[0], v0: U.at(body[0]), i1: brk ? brk.i : e, v1: U.at(brk ? brk.i : e) }, { i0: body[0], v0: Lw.at(body[0]), i1: brk ? brk.i : e, v1: Lw.at(brk ? brk.i : e) }],
          stop: brk ? (dir > 0 ? Math.min(...body.map(i => m.l[i])) : Math.max(...body.map(i => m.h[i]))) : null, extra: `pole ${(pole / a).toFixed(1)} ATR; volume in the ${pennant ? 'pennant' : 'flag'} ${(fv / pv).toFixed(2)}× the pole's` };
        out.push(finish(p, m, n, A, o));
        return out;                           // the most recent pole only
      }
    }
    return out;
  }

  // double and triple tops and bottoms; head and shoulders and the inverse
  function reversals(m, n, A, pv, o) {
    const out = [], e = n - 1;
    for (const dir of [-1, 1]) {           // -1 = tops (bearish), +1 = bottoms (bullish)
      const pts = (dir < 0 ? pv.hi : pv.lo).filter(q => q.p >= e - o.win && q.p + o.k <= e);
      const beyond = (x, y) => dir < 0 ? x > y : x < y, ext = i => dir < 0 ? m.h[i] : m.l[i];
      // double / triple
      for (let b = pts.length - 1; b >= 1 && !out.some(x => x.dir0 === dir && /top|bot/.test(x.type)); b--) {
        const P2 = pts[b], a = A[P2.p];
        for (let f = b - 1; f >= 0; f--) {
          const P1 = pts[f], gap = P2.p - P1.p; if (gap < 8) continue; if (gap > 100) break;
          if (Math.abs(P1.v - P2.v) > o.peakTol * a) continue;
          let ti = P1.p; for (let i = P1.p; i <= P2.p; i++) if (dir < 0 ? m.l[i] < m.l[ti] : m.h[i] > m.h[ti]) ti = i;
          const T = dir < 0 ? m.l[ti] : m.h[ti], peak = dir < 0 ? Math.max(P1.v, P2.v) : Math.min(P1.v, P2.v), depth = Math.abs(peak - T) / a;
          if (depth < o.depth) continue;
          const pre = P1.p - 20 >= 0 ? (dir < 0 ? P1.v - m.c[P1.p - 20] : m.c[P1.p - 20] - P1.v) / a : 0; if (pre < o.trend) continue;
          let broken = false; for (let i = P2.p + 1; i <= e; i++) if (beyond(ext(i), peak + (dir < 0 ? 0.3 : -0.3) * a)) { broken = true; break; }   // a new extreme ends it
          const P0 = pts[f - 1]; let triple = P0 && Math.abs(P0.v - P1.v) <= o.peakTol * a && P1.p - P0.p >= 8 && P1.p - P0.p <= 100;
          if (triple) { let t0 = P0.p; for (let i = P0.p; i <= P1.p; i++) if (dir < 0 ? m.l[i] < m.l[t0] : m.h[i] > m.h[t0]) t0 = i; if (Math.abs((dir < 0 ? m.l[t0] : m.h[t0]) - (dir < 0 ? m.l[ti0()] : m.h[ti0()])) > a) triple = false; }   // a triple needs a level neckline
          function ti0() { let t = P1.p; for (let i = P1.p; i <= P2.p; i++) if (dir < 0 ? m.l[i] < m.l[t] : m.h[i] > m.h[t]) t = i; return t; }
          let brk = null; for (let i = P2.p + 1; i <= e; i++) if (dir < 0 ? m.c[i] < T : m.c[i] > T) { let fail = -1; for (let k = i + 1; k <= e; k++) if (dir < 0 ? m.c[k] > peak : m.c[k] < peak) { fail = k; break; } brk = { i, dir: dir < 0 ? -1 : 1, at: T, fail }; break; }
          if (broken && !brk) continue;
          const vp = v => avg(m.v, v.p - 2, v.p + 2), type = dir < 0 ? (triple ? 'ttop' : 'dtop') : (triple ? 'tbot' : 'dbot');
          const p = { type, dir0: dir, from: (triple ? P0 : P1).p, to: brk ? brk.i : e, brk, height: Math.abs(peak - T), peaks: (triple ? [P0, P1, P2] : [P1, P2]).map(q => ({ i: q.p, v: q.v })), neck: { i0: P1.p, i1: brk ? brk.i : e, v: T },
            vol: { contracted: vp(P2) < vp(P1), brkX: brk ? m.v[brk.i] / avg(m.v, P1.p, P2.p) : null }, stop: peak + (dir < 0 ? 0.25 : -0.25) * a, extra: `${dir < 0 ? 'peaks' : 'lows'} ${Math.abs(P1.v / P2.v - 1) < 0.0005 ? 'level' : (100 * Math.abs(P1.v / P2.v - 1)).toFixed(2) + '% apart'}, ${gap} bars apart; neckline ${T.toPrecision(5)}` };
          out.push(finish(p, m, n, A, o)); break;
        }
      }
      // head and shoulders
      for (let r = pts.length - 1; r >= 2; r--) {
        const Ls = pts[r - 2], Hd = pts[r - 1], Rs = pts[r], a = A[Rs.p];
        if (Hd.p - Ls.p < 4 || Rs.p - Hd.p < 4 || Rs.p - Ls.p > 120) continue;
        if (!(beyond(Hd.v, Ls.v + (dir < 0 ? 0.5 : -0.5) * a) && beyond(Hd.v, Rs.v + (dir < 0 ? 0.5 : -0.5) * a))) continue;
        if (Math.abs(Ls.v - Rs.v) > 1.2 * a) continue;
        const tr = (i0, i1) => { let t = i0; for (let i = i0; i <= i1; i++) if (dir < 0 ? m.l[i] < m.l[t] : m.h[i] > m.h[t]) t = i; return t; };
        const ext2 = i => dir < 0 ? m.l[i] : m.h[i], t1 = tr(Ls.p, Hd.p), t2 = tr(Hd.p, Rs.p), neck = fit([{ p: t1, v: ext2(t1) }, { p: t2, v: ext2(t2) }]);
        const pre = Ls.p - 20 >= 0 ? (dir < 0 ? Ls.v - m.c[Ls.p - 20] : m.c[Ls.p - 20] - Ls.v) / a : 0; if (pre < o.trend * 0.7) continue;
        let gone = false; for (let i = Rs.p + 1; i <= e; i++) if (beyond(ext(i), Rs.v + (dir < 0 ? 0.3 : -0.3) * a) && !(dir < 0 ? m.c[i] < neck.at(i) : m.c[i] > neck.at(i))) { gone = true; break; }
        let brk = null; for (let i = Rs.p + 1; i <= e; i++) if (dir < 0 ? m.c[i] < neck.at(i) : m.c[i] > neck.at(i)) { let fail = -1; for (let k = i + 1; k <= e; k++) if (dir < 0 ? m.c[k] > Rs.v : m.c[k] < Rs.v) { fail = k; break; } brk = { i, dir: dir < 0 ? -1 : 1, at: neck.at(i), fail }; break; }
        if (gone && !brk) continue;
        const height = Math.abs(Hd.v - neck.at(Hd.p));
        const p = { type: dir < 0 ? 'hs' : 'ihs', dir0: dir, from: Ls.p, to: brk ? brk.i : e, brk, height, peaks: [Ls, Hd, Rs].map(q => ({ i: q.p, v: q.v })), neckLine: { i0: t1, v0: neck.at(t1), i1: brk ? brk.i : e, v1: neck.at(brk ? brk.i : e) },
          vol: { contracted: avg(m.v, Rs.p - 2, Rs.p + 2) < avg(m.v, Ls.p - 2, Ls.p + 2), brkX: brk ? m.v[brk.i] / avg(m.v, Ls.p, Rs.p) : null }, stop: Rs.v + (dir < 0 ? 0.25 : -0.25) * a, extra: `head ${(Math.abs(Hd.v - Math.max(Ls.v, Rs.v)) / a).toFixed(1)} ATR beyond the shoulders` };
        out.push(finish(p, m, n, A, o)); break;
      }
    }
    return out;
  }

  // All patterns on the closed candles (n = number of closed candles).
  function find(m, n, opt = {}) {
    const o = Object.assign({}, P, opt); if (n < 60) return [];
    const A = atr(m, n), pv = pivots(m, n, o.k);
    const ln = lines(m, n, A, pv, o), within = p => ln.some(L => p.from >= L.from - 2 && (p.brk ? p.brk.i : p.to) <= L.to + 2);
    const all = [...ln, ...flags(m, n, A, o).filter(p => !within(p)), ...reversals(m, n, A, pv, o).filter(p => !within(p))];   // a leg or peaks inside a larger pattern belong to it
    // newest first; drop failed patterns older than 30 bars and anything that ended long ago
    return all.filter(p => !(p.status === 'failed' && n - 1 - p.brk.fail > 30) && n - 1 - p.to <= 30).sort((a, b) => b.to - a.to).slice(0, 4);
  }

  // Candle rejections at levels. levels: [{ lo, hi, what }]; dynamic EMA 50/200 (and session VWAP when intraday) are added here.
  function rejections(m, n, levels = [], opt = {}) {
    const A = atr(m, n), out = [], from = Math.max(21, n - (opt.look || 150));
    const ema = k => { const q = 2 / (k + 1), r = [m.c[0]]; for (let i = 1; i < n; i++) r.push(m.c[i] * q + r[i - 1] * (1 - q)); return r; };
    const e50 = ema(50), e200 = ema(200);
    let vw = null; if (opt.intraday && m.t) { vw = []; let pv = 0, vv = 0, day = -1; for (let i = 0; i < n; i++) { const d = Math.floor(m.t[i] / 864e5); if (d !== day) { day = d; pv = 0; vv = 0; } const tp = (m.h[i] + m.l[i] + m.c[i]) / 3; pv += tp * m.v[i]; vv += m.v[i]; vw.push(vv ? pv / vv : tp); } }
    for (let i = from; i < n; i++) {
      const a = A[i], o = m.o[i], c = m.c[i], h = m.h[i], l = m.l[i], rg = h - l || 1e-12, body = Math.abs(c - o), lw = Math.min(o, c) - l, uw = h - Math.max(o, c);
      let avgRg = 0; for (let k = i - 20; k < i; k++) avgRg += m.h[k] - m.l[k]; avgRg /= 20;
      const nearW = side => { let mx = 0; for (let k = i - 5; k < i; k++) mx = Math.max(mx, side > 0 ? Math.min(m.o[k], m.c[k]) - m.l[k] : m.h[k] - Math.max(m.o[k], m.c[k])); return mx; };
      const inPrior = Math.min(o, c) >= m.l[i - 1] && Math.max(o, c) <= m.h[i - 1];
      const kinds = [];
      if (lw >= 2 * body && (c - l) / rg >= 0.66 && lw > nearW(1) && inPrior) kinds.push([1, 'Pin bar', lw]);
      if (uw >= 2 * body && (h - c) / rg >= 0.66 && uw > nearW(-1) && inPrior) kinds.push([-1, 'Pin bar', uw]);
      if (c > o && m.c[i - 1] < m.o[i - 1] && o <= m.c[i - 1] && c >= m.o[i - 1]) kinds.push([1, 'Bullish engulfing', lw]);
      if (c < o && m.c[i - 1] > m.o[i - 1] && o >= m.c[i - 1] && c <= m.o[i - 1]) kinds.push([-1, 'Bearish engulfing', uw]);
      if (h > m.h[i - 1] && l < m.l[i - 1] && !kinds.length) { if (c > o && (c - l) / rg >= 0.6) kinds.push([1, 'Outside bar', lw]); else if (c < o && (h - c) / rg >= 0.6) kinds.push([-1, 'Outside bar', uw]); }
      if (!kinds.length) continue;
      const [side, kind, wick] = kinds[0];
      const lv = levels.filter(z => z.from == null || z.from < i).map(z => ({ lo: z.lo, hi: z.hi ?? z.lo, what: z.what }))   // only levels that existed before the candle.concat([{ lo: e50[i - 1], hi: e50[i - 1], what: 'EMA50' }, { lo: e200[i - 1], hi: e200[i - 1], what: 'EMA200' }]).concat(vw ? [{ lo: vw[i - 1], hi: vw[i - 1], what: 'session VWAP' }] : []);
      // the wick must reach the level and the close must stay on the right side of it
      const hit = lv.filter(z => ok(z.lo) && (side > 0 ? l <= z.hi + 0.2 * a && c >= z.lo - 0.05 * a && l >= z.lo - 1.5 * a : h >= z.lo - 0.2 * a && c <= z.hi + 0.05 * a && h <= z.hi + 1.5 * a));
      if (!hit.length) continue;
      const lvl = hit.sort((x, y) => (side > 0 ? Math.abs(l - x.hi) - Math.abs(l - y.hi) : Math.abs(h - x.lo) - Math.abs(h - y.lo)))[0];
      let status = 'waiting', j = -1;
      for (let k = i + 1; k <= Math.min(n - 1, i + 2); k++) { if (side > 0 ? m.c[k] < l : m.c[k] > h) { status = 'failed'; j = k; break; } if (side > 0 ? m.h[k] > h : m.l[k] < l) { status = 'confirmed'; j = k; break; } }
      if (status === 'waiting' && i + 2 <= n - 1) status = 'no follow-through';
      out.push({ i, side, kind, level: lvl, status, at: j, longWick: wick > 4 * avgRg, stop: side > 0 ? l - 0.1 * a : h + 0.1 * a, trigger: side > 0 ? h : l });
    }
    return out;
  }
  return { P, NAME, BIAS, find, rejections, atr, pivots };
})();
if (typeof module !== 'undefined') module.exports = PAT;
