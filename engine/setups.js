// Breakout-and-retest setups (no DOM). Built on RADAR. Input: closed 15m candles m = {t (open ms), o, h, l, c, v (base volume), tb (taker-buy base volume)}.
// Point in time: at each 15m close only 4H candles that have closed, and 4H swings whose 2 confirming candles have closed, are used.
const SETUPS = ((R) => {
  const M15 = 15 * 60e3, H4 = 4 * 3600e3, DAY = 864e5;
  const DEF = {
    swing: 2,            // a 4H swing high / low has 2 lower highs / higher lows on each side; known when the 2nd one closes
    look4: 60,           // ceilings and swing lows from the last 60 4H candles (10 days)
    atrK: 1,             // early warning: below the ceiling by at most 1 × ATR14 (4H)
    bwLen: 20, bwK: 2, bwPct: 0.2, bwLook: 100, bwMin: 50,   // Bollinger BandWidth (20, 2) in the lowest 20% of the previous 100 4H readings (50 at least)
    rvDays: 20, rvMinDays: 10, rvMin: 1.3,                    // cumulative volume since 00:00 UTC vs the same time of day, previous 20 days (10 at least)
    brkVol: 1.5, brkLook: 20,                                 // breakout bar volume vs the previous 20 closed 15m bars
    within: 96,          // 24 hours of 15m bars: alert window before a breakout, spike window, retest window, holding time
    tol: 0.1,            // a retest touches the level within 0.1 × ATR14 (15m)
    stopBuf: 0.25,       // stop 0.25 × ATR14 (15m) below the retest low
    fee: 0.001, slip: 0.0005,                                 // per side: Binance spot taker fee 0.10%, slippage and half the spread 0.05%
    minR: 2, targetR: 2,
    squeezeLook: 1,      // variant: a squeeze on any of the last N 4H readings (1 = the latest only, as written)
    volFloor: false,     // variant: breakout volume against max(average of 20, median of 96 bars), and at least $25,000 traded in the bar
    noEntry: null,       // variant: function (time) → true to skip a new paper entry (session filter)
    // book variants (playbook rebuild, 27 Nov 2026), all off = as written
    cleanBreak: false,   // [SMC p10, DT p64/p110/p114] the breakout bar closes in the top third of its range with a body of at least half the range
    quietRetest: false,  // [DT p64/p111, SMC p66, TAD p72] the retest bar trades less volume than the breakout bar and than its own 20-bar average
    baseStop: false,     // [SMC p36/p57-58/p101, DT p44] stop below the 4-hour base before the breakout (and the retest low), not just under the retest
  };
  const ok = x => x != null && Number.isFinite(x);
  const sma = (a, i, n) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += a[k]; return s / n; };
  function to4H(m, n) {                    // complete 4H candles only (16 closed 15m candles each)
    const d = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cnt = 0;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(m.t[i] / H4) * H4, j = d.t.length - 1;
      if (j >= 0 && d.t[j] === b) { d.h[j] = Math.max(d.h[j], m.h[i]); d.l[j] = Math.min(d.l[j], m.l[i]); d.c[j] = m.c[i]; d.v[j] += m.v[i]; cnt++; }
      else { if (j >= 0 && cnt < 16) for (const k in d) d[k].pop(); d.t.push(b); d.o.push(m.o[i]); d.h.push(m.h[i]); d.l.push(m.l[i]); d.c.push(m.c[i]); d.v.push(m.v[i]); cnt = 1; }
    }
    if (d.t.length && cnt < 16) for (const k in d) d[k].pop();
    return d;
  }
  function ind4(d, o) {
    const n = d.c.length, A = R.atr(d), RS = R.rsi(d.c), e = (a, k) => { const q = 2 / (k + 1), r = [a[0]]; for (let i = 1; i < a.length; i++) r.push(a[i] * q + r[i - 1] * (1 - q)); return r; };
    const m12 = e(d.c, 12), m26 = e(d.c, 26), mac = m12.map((x, i) => x - m26[i]), sg = e(mac, 9), hist = mac.map((x, i) => x - sg[i]);
    const bw = Array(n).fill(NaN), pct = Array(n).fill(NaN);
    for (let i = o.bwLen - 1; i < n; i++) { const mu = sma(d.c, i, o.bwLen); let v = 0; for (let k = i - o.bwLen + 1; k <= i; k++) v += (d.c[k] - mu) ** 2; bw[i] = 2 * o.bwK * Math.sqrt(v / o.bwLen) / mu; }
    for (let i = 0; i < n; i++) { if (!ok(bw[i])) continue; const prev = []; for (let k = Math.max(0, i - o.bwLook); k < i; k++) if (ok(bw[k])) prev.push(bw[k]); if (prev.length >= o.bwMin) pct[i] = prev.filter(x => x < bw[i]).length / prev.length; }
    const ph = [], pl = [], s = o.swing;               // pivots, with the index of the 4H candle that confirms them
    for (let k = s; k < n - s; k++) {
      let hi = true, lo = true; for (let q = 1; q <= s; q++) { if (!(d.h[k] > d.h[k - q] && d.h[k] >= d.h[k + q])) hi = false; if (!(d.l[k] < d.l[k - q] && d.l[k] <= d.l[k + q])) lo = false; }
      if (hi) ph.push({ k, conf: k + s, lv: d.h[k] }); if (lo) pl.push({ k, conf: k + s, lv: d.l[k] });
    }
    return { A, RS, hist, bw, pct, ph, pl };
  }
  function rvolAt(m, n, o) {               // cumulative quote volume since 00:00 UTC vs the same time of day on earlier days
    const cum = new Float64Array(n), idx = new Map(); let day = -1;
    for (let i = 0; i < n; i++) { const dd = Math.floor(m.t[i] / DAY); cum[i] = (dd === day ? cum[i - 1] : 0) + m.v[i]; day = dd; idx.set(m.t[i], i); }
    const out = new Float64Array(n).fill(NaN), days = new Int16Array(n);
    for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let q = 1; q <= o.rvDays; q++) { const j = idx.get(m.t[i] - q * DAY); if (j != null) { s += cum[j]; k++; } } days[i] = k; if (k >= o.rvMinDays && s > 0) out[i] = cum[i] / (s / k); }
    return { rv: out, days };
  }
  function vwapAt(m, n) {                  // session VWAP from 00:00 UTC: typical price weighted by base volume
    const out = new Float64Array(n); let day = -1, q = 0, b = 0;
    for (let i = 0; i < n; i++) { const dd = Math.floor(m.t[i] / DAY), tp = (m.h[i] + m.l[i] + m.c[i]) / 3; if (dd !== day) { q = 0; b = 0; day = dd; } q += tp * m.v[i]; b += m.v[i]; out[i] = b > 0 ? q / b : tp; }
    return out;
  }
  // replay every closed 15m candle; returns events, breakouts with their spike / retest / trade outcome, and the state at the last candle
  function replay(m, opt = {}) {
    const o = Object.assign({}, DEF, opt), n = opt.n != null ? opt.n : m.c.length, c = m.c;
    if (n < 400) return null;
    const d4 = to4H(m, n), I = ind4(d4, o), A15 = R.atr(m), RV = rvolAt(m, n, o), VW = vwapAt(m, n);
    const broken = new Set(), alerts = [], brks = []; let K = 0, ceil = null, firstW = {}, last = null;
    const confirmedHighs = K => I.ph.filter(p => p.conf < K && p.k >= K - o.look4);
    const lowsBefore = K => I.pl.filter(p => p.conf < K && p.k >= K - o.look4);
    for (let j = 1; j < n; j++) {
      const T = m.t[j] + M15; while (K < d4.t.length && d4.t[K] + H4 <= T) K++;
      if (K < 30) continue;
      const k4 = K - 1, atr4 = I.A[k4];
      // 1) a close above the ceiling known at the previous close is a breakout of that level
      if (ceil && c[j] > ceil.lv) {
        let vs = 0; for (let q = j - o.brkLook; q < j; q++) vs += m.v[q]; let den = vs / o.brkLook;
        if (o.volFloor) { const w = m.v.slice(Math.max(0, j - 96), j).sort((a, b) => a - b); den = Math.max(den, w[w.length >> 1] || 0); }
        let vm = den > 0 ? m.v[j] / den : Infinity; if (o.volFloor && m.v[j] * c[j] < 25000) vm = Math.min(vm, 1);
        const fw = firstW[ceil.id] || {}, inWin = t => t != null && t <= T && t >= T - o.within * M15;
        brks.push({ j, t: T, lv: ceil.lv, id: ceil.id, close: c[j], atr4: ceil.atr4 || atr4, vm, tb: m.v[j] > 0 ? m.tb[j] / m.v[j] : NaN,
          base: inWin(fw.base) ? fw.base : null, full: inWin(fw.full) ? fw.full : null });
      }
      for (const p of I.ph) if (p.conf < K && p.lv < c[j]) broken.add(p.k);
      // 2) the range ceiling: the highest unbroken confirmed 4H swing high of the last 10 days, above this close
      const hs = confirmedHighs(K).filter(p => !broken.has(p.k) && p.lv > c[j]).sort((a, b) => b.lv - a.lv);
      ceil = hs.length ? { lv: hs[0].lv, id: hs[0].k, atr4 } : null;
      // 3) early-warning checks on this close
      const lows = lowsBefore(K), hl = lows.length >= 2 && lows[lows.length - 1].lv > lows[lows.length - 2].lv;
      const near = !!ceil && c[j] < ceil.lv && ceil.lv - c[j] <= o.atrK * atr4, dist = ceil ? (ceil.lv - c[j]) / atr4 : NaN;
      let squeeze = false; for (let q = 0; q < o.squeezeLook && k4 - q >= 0; q++) if (ok(I.pct[k4 - q]) && I.pct[k4 - q] <= o.bwPct) { squeeze = true; break; }
      const vol = ok(RV.rv[j]) && RV.rv[j] >= o.rvMin, full = near && hl && squeeze && vol;
      if (near) { const f = firstW[ceil.id] = firstW[ceil.id] || {}; if (f.base == null) { f.base = T; alerts.push({ v: 'base', t: T, j, lv: ceil.lv, id: ceil.id, dist }); } if (full && f.full == null) { f.full = T; alerts.push({ v: 'full', t: T, j, lv: ceil.lv, id: ceil.id, dist }); } }
      if (j === n - 1) last = { j, T, price: c[j], ceil, dist, near, hl, lows: lows.slice(-2).map(p => p.lv), squeeze, bwPct: I.pct[k4], rv: RV.rv[j], rvDays: RV.days[j], vol, full,
        atr4, rsi4: I.RS[k4], rsiReclaim: I.RS[k4] >= 50 && Math.min(I.RS[k4 - 1], I.RS[k4 - 2]) < 50, hist: I.hist[k4], histUp: I.hist[k4] > I.hist[k4 - 1] && I.hist[k4 - 1] > I.hist[k4 - 2], vwap: VW[j], atr15: A15[j], t4: d4.t[k4] };
    }
    // 4) after each breakout: spike, retest, paper trade (one open trade at a time)
    const cost = o.fee + o.slip; let busyUntil = -1, busyPaper = -1;   // busyUntil: the plain retest strategy; busyPaper: the paper entry the dashboard shows (its own position, so a plain trade below VWAP never blocks it)
    // first resistance visible at entry: the nearest confirmed 4H swing high above, else the highest 4H high before the breakout
    const resistAbove = (px, K, skip, tB) => { const hs = I.ph.filter(p => p.conf < K && p.k !== skip && p.lv > px).sort((a, b) => a.lv - b.lv); if (hs.length) return { lv: hs[0].lv, src: '4H swing high' }; let mx = -Infinity, k = 0; for (; k < K && d4.t[k] + H4 <= tB; k++) mx = Math.max(mx, d4.h[k]); return mx > px ? { lv: mx, src: `${Math.round(k / 6)}-day high` } : null; };
    for (const b of brks) {
      const end = Math.min(n - 1, b.j + o.within);
      b.spike = false; for (let q = b.j + 1; q <= end; q++) if (m.h[q] >= b.lv + b.atr4) { b.spike = true; b.spikeT = m.t[q] + M15; break; }
      b.spike3 = false; for (let q = b.j + 1; q <= end; q++) if (m.h[q] >= b.lv + 3 * b.atr4) { b.spike3 = true; break; }
      b.spikeOpen = !b.spike && b.j + o.within > n - 1;           // still inside its 24 hours
      b.ran = false; b.state = 'await';
      for (let q = b.j + 1; q <= end; q++) {
        if (m.l[q] <= b.lv + o.tol * A15[q]) { if (c[q] > b.lv) { b.state = 'retest'; b.rq = q; } else { b.state = 'failed'; b.fq = q; b.failT = m.t[q] + M15; } break; }
        if (m.h[q] >= b.lv + b.atr4) b.ran = true;
      }
      if (b.state === 'await' && b.j + o.within <= n - 1) b.state = b.ran ? 'extended' : 'expired';
      if (b.state !== 'retest') continue;
      const q = b.rq, Tq = m.t[q] + M15; let Kq = 0; while (Kq < d4.t.length && d4.t[Kq] + H4 <= Tq) Kq++;
      let lowB = m.l[q]; if (o.baseStop) for (let k = Math.max(0, b.j - 16); k < b.j; k++) lowB = Math.min(lowB, m.l[k]);
      const known = q + 1 < n, entry = known ? m.o[q + 1] : c[q], stop = lowB - o.stopBuf * A15[q], Eb = entry * (1 + cost), risk = Eb - stop * (1 - cost);
      const rgB = m.h[b.j] - m.l[b.j], weakBar = o.cleanBreak && !(rgB > 0 && (c[b.j] - m.l[b.j]) / rgB >= 2 / 3 && (c[b.j] - m.o[b.j]) / rgB >= 0.5);
      let loud = false; if (o.quietRetest) { let s20 = 0; for (let k = q - 20; k < q; k++) s20 += m.v[k]; loud = !(m.v[q] < m.v[b.j] && m.v[q] < s20 / 20); }
      const res = resistAbove(entry, Kq, b.id, b.t - M15), rr = res ? (res.lv * (1 - cost) - Eb) / risk : Infinity;
      const tgt = (Eb + o.targetR * risk) / (1 - cost);
      b.trade = { q, t: Tq, entry, pending: !known, stop, target: tgt, risk, costR: (entry + stop) * cost / risk, res, rr, vwap: VW[q], aboveVwap: c[q] > VW[q] };
      const plainOk = risk > 0 && rr >= o.minR && !weakBar && !loud, fullOk = plainOk && b.full != null && b.vm >= o.brkVol && c[q] > VW[q];
      // the paper entry the dashboard shows follows the rule as written: a confirmed breakout (volume), a retest that closes back above the level and above session VWAP, 2R to the first resistance
      const lowVol = !(b.vm >= o.brkVol), belowV = !(c[q] > VW[q]), paperOk = plainOk && !lowVol && !belowV;
      const sess = o.noEntry ? o.noEntry(Tq) : false;
      const takePlain = plainOk && !sess && q >= busyUntil, takePaper = paperOk && !sess && q >= busyPaper;
      b.trade.plain = takePlain; b.trade.fullOk = fullOk && takePlain; b.trade.paper = takePaper;
      b.trade.skip = !(risk > 0) ? 'no risk' : weakBar ? 'weak breakout bar' : loud ? 'loud retest' : rr < o.minR ? `R:R ${rr.toFixed(1)} to the ${res.src}` : q < busyUntil ? 'a trade was already open' : sess ? 'session filter' : null;
      b.trade.pskip = !(risk > 0) ? 'no risk' : weakBar ? 'weak breakout bar' : loud ? 'loud retest' : rr < o.minR ? `R:R ${rr.toFixed(1)} to the ${res.src}` : lowVol ? 'breakout volume under 1.5×' : belowV ? 'retest closed below VWAP' : q < busyPaper ? 'a paper trade was already open' : sess ? 'session filter' : null;
      if (!takePlain && !takePaper) continue;
      // simulate once: entry at the next open; stop first when both are touched in one candle; time exit 24 hours after entry (the same for every strategy that takes the trade)
      let out = null;
      for (let k = q + 1; k < n && k <= q + o.within; k++) {
        const hitS = m.l[k] <= stop, hitT = m.h[k] >= tgt;
        if (hitS) { const px = Math.min(stop, m.o[k]); out = { why: 'stop', k, px, ambig: hitT }; break; }
        if (hitT) { const px = Math.max(tgt, m.o[k]); out = { why: 'target', k, px }; break; }
      }
      if (!out && q + 1 + o.within < n) out = { why: 'time', k: q + 1 + o.within, px: m.o[q + 1 + o.within] };
      if (out) { out.t = m.t[out.k] + (out.why === 'time' ? 0 : M15); out.r = (out.px * (1 - cost) - Eb) / risk; }
      const now = known ? (c[n - 1] * (1 - cost) - Eb) / risk : null;      // no running result until the entry price exists
      if (takePlain) { if (out) { b.trade.exit = out; busyUntil = out.k; } else { b.trade.open = true; b.trade.now = (c[n - 1] * (1 - cost) - Eb) / risk; busyUntil = n; } }
      if (takePaper) { if (out) { b.trade.pexit = out; busyPaper = out.k; } else { b.trade.popen = true; b.trade.pnow = now; busyPaper = n; } }
    }
    // 5) the coin's status at the last close
    let st = null; const lastB = brks.length ? brks[brks.length - 1] : null, recent = lastB && last && last.T - lastB.t <= o.within * M15;
    const PT = lastB && lastB.trade;
    if (PT && PT.paper && PT.popen) st = PT.pending ? 'armed' : 'entry';      // armed: the retest closed and qualifies, the entry price is the next open, not known yet
    else if (recent) st = lastB.state === 'await' ? (lastB.ran ? 'extended' : 'await') : lastB.state === 'retest' ? (PT && PT.paper && PT.pexit ? 'done' : 'skipped') : lastB.state;
    if (st === 'expired') st = null;
    if (!st && last && last.full) st = 'warn'; else if (!st && last && last.near) st = 'near';
    return { o, n, last, alerts, brks, status: st, lastBrk: lastB, d4n: d4.t.length };
  }
  // the chance of reaching the target before the stop within the holding time, from Monte Carlo paths of the coin's own 15m candles
  function tradeOdds({ d, i, stop, target, entry, N = 20000, H = 96, su = 1, sd = 1, fee = DEF.fee, slip = DEF.slip, seed = 7 }) {
    const steps = R.neutralSteps(d, i), A = R.atr(d), c0 = d.c[i], u = Math.log(1 + A[i] / c0), S = steps.length, rand = R.rnd(seed), cost = fee + slip;
    const zS = Math.log(stop / c0) / u, zT = Math.log(target / c0) / u, Eb = entry * (1 + cost), risk = Eb - stop * (1 - cost);
    if (!(zS < 0) || !(zT > 0) || !(risk > 0)) return null;
    let nT = 0, nS = 0, sumR = 0; const rs = new Float32Array(N);
    for (let p = 0; p < N; p++) {
      let x = 0, s0 = Math.floor(rand() * (S - 2)), bi = 0, r = null;
      for (let h = 0; h < H; h++) {
        if (bi === 3) { s0 = Math.floor(rand() * (S - 2)); bi = 0; } const st = steps[Math.min(S - 1, s0 + bi++)], a = h < 6 ? su : 1, b = h < 6 ? sd : 1;
        const dc = st[0] > 0 ? st[0] * a : st[0] * b, dh = Math.max(st[1] - Math.max(0, st[0]), 0) * a, dl = Math.max(Math.min(0, st[0]) - st[2], 0) * b;
        const lo = Math.min(x, x + dc) - dl, hi = Math.max(x, x + dc) + dh;
        if (lo <= zS) { r = (stop * (1 - cost) - Eb) / risk; nS++; break; }
        if (hi >= zT) { r = (target * (1 - cost) - Eb) / risk; nT++; break; }
        x += dc;
      }
      if (r == null) r = (c0 * Math.exp(x * u) * (1 - cost) - Eb) / risk;
      rs[p] = r; sumR += r;
    }
    return { N, H, target: nT / N, stop: nS / N, time: (N - nT - nS) / N, meanR: sumR / N, su, sd };
  }
  // scanner and trade tables across coins (the test the strategy asks for)
  function summarize(list, o = DEF) {
    const W = o.within * M15, med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
    const sc = { base: { alerts: 0, toSpike: 0, lead: [] }, full: { alerts: 0, toSpike: 0, lead: [] } }, spikes = { n: 0, base: 0, full: 0 };
    const tr = { plain: [], full: [] }, notes = { failed: 0, extended: 0, expired: 0, skipped: 0, open: 0 };
    for (const { coin, r } of list) {
      if (!r) continue;
      for (const a of r.alerts) { const s = sc[a.v]; s.alerts++; const b = r.brks.find(x => x.id === a.id && x.t >= a.t && x.t - a.t <= W); if (b && b.spike) { s.toSpike++; s.lead.push((b.t - a.t) / 3600e3); } }
      for (const b of r.brks) {
        if (b.spike) { spikes.n++; if (b.base != null) spikes.base++; if (b.full != null) spikes.full++; }
        if (b.state === 'failed') notes.failed++; else if (b.state === 'extended') notes.extended++; else if (b.state === 'expired') notes.expired++;
        const t = b.trade; if (!t) continue; if (t.skip) notes.skipped++; if (t.open) notes.open++;
        if (t.exit && t.plain) tr.plain.push({ coin, t: t.t, r: t.exit.r, why: t.exit.why });
        if (t.exit && t.fullOk) tr.full.push({ coin, t: t.t, r: t.exit.r, why: t.exit.why });
      }
    }
    const trades = a => { a.sort((x, y) => x.t - y.t); let cum = 0, peak = 0, dd = 0; for (const x of a) { cum += x.r; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); } const best = a.length ? Math.max(...a.map(x => x.r)) : 0;
      return { n: a.length, avgR: a.length ? cum / a.length : NaN, totalR: cum, maxDD: dd, win: a.filter(x => x.why === 'target').length, loss: a.filter(x => x.why === 'stop').length, time: a.filter(x => x.why === 'time').length, totalNoBest: cum - best }; };
    const scan = k => ({ alerts: sc[k].alerts, hitRate: sc[k].alerts ? sc[k].toSpike / sc[k].alerts : NaN, caught: spikes.n ? spikes[k] / spikes.n : NaN, leadH: med(sc[k].lead) });
    return { spikes: spikes.n, scanner: { base: scan('base'), full: scan('full') }, trade: { plain: trades(tr.plain), full: trades(tr.full) }, notes };
  }
  // fast "Moving" pings (from the spike-radar prompt, replayed on 130 coins before adding, 27 Nov 2026): a completed 15m candle closes
  // at least 0.75% above the previous close on at least 2x the average volume of the previous 20 candles; one ping per coin per hour.
  // A ping is "look at the chart now", not an entry. Scored against spikes: a 15m close 5% above the close one hour (4 candles)
  // earlier, at most one per coin per 24 hours; a ping counts when such a spike completes within the next 2 hours (8 candles).
  const PING = { up: 0.0075, vol: 2, look: 20, gap: 4, hi: 16, buy: 0.55, spike: 0.05, spikeBars: 4, spikeGap: 96, win: 8 };
  function pings(m, opt = {}) {
    const p = Object.assign({}, PING, opt), n = opt.n != null ? opt.n : m.c.length, c = m.c;
    if (n < p.look + 2) return null;
    const VW = vwapAt(m, n), spikes = []; let nx = 0;
    for (let k = p.spikeBars; k < n; k++) if (k >= nx && c[k] / c[k - p.spikeBars] >= 1 + p.spike) { spikes.push({ k, t: m.t[k] + M15, gain: c[k] / c[k - p.spikeBars] - 1 }); nx = k + p.spikeGap; }
    const out = []; let last = -99;
    for (let j = p.look + 1; j < n; j++) {
      let av = 0; for (let q = j - p.look; q < j; q++) av += m.v[q]; av /= p.look;
      const r = c[j] / c[j - 1] - 1; if (!(r >= p.up && av > 0 && m.v[j] >= p.vol * av) || j - last < p.gap) continue;
      last = j; let hh = -Infinity; for (let q = Math.max(0, j - p.hi); q < j; q++) hh = Math.max(hh, m.h[q]);
      let mx = -Infinity; for (let q = j + 1; q <= Math.min(n - 1, j + p.win); q++) mx = Math.max(mx, m.h[q]);
      const sp = spikes.find(x => x.k > j && x.k <= j + p.win), buy = m.tb && m.v[j] > 0 ? m.tb[j] / m.v[j] : NaN;
      out.push({ j, t: m.t[j] + M15, price: c[j], r, vm: m.v[j] / av, buy, vwap: VW[j], aboveVwap: c[j] > VW[j], hi16: hh, above16: c[j] > hh,
        confirmed: c[j] > hh && c[j] > VW[j] && buy >= p.buy, maxUp: mx > -Infinity ? mx / c[j] - 1 : NaN, spikeAt: sp ? sp.t : null, done: !!sp || j + p.win <= n - 1 });
    }
    let bN = 0, bH = 0; for (let j = p.look + 1; j + p.win <= n - 1; j += 4) { bN++; if (spikes.some(x => x.k > j && x.k <= j + p.win)) bH++; }
    return { pings: out, spikes, n, from: m.t[0], to: m.t[n - 1] + M15, baseN: bN, baseHit: bH };
  }
  function pingScore(list, since = -Infinity, p = PING) {     // list: pings() results; counts pings and spikes at or after `since`
    let a = 0, hit = 0, sp = 0, caught = 0, bN = 0, bH = 0; const lead = [];
    for (const x of list) {
      if (!x) continue; bN += x.baseN; bH += x.baseHit;
      for (const q of x.pings) if (q.done && q.t >= since) { a++; if (q.spikeAt) hit++; }
      for (const s of x.spikes) { if (s.t < since) continue; sp++; const f = x.pings.find(q => q.j >= s.k - p.win && q.j < s.k); if (f) { caught++; lead.push((s.k - f.j) * 15); } }
    }
    const sl = [...lead].sort((u, v) => u - v);
    return { pings: a, followed: hit, hitRate: a ? hit / a : NaN, chance: bN ? bH / bN : NaN, spikes: sp, caught, caughtShare: sp ? caught / sp : NaN, leadMin: sl.length ? sl[sl.length >> 1] : NaN };
  }
  return { DEF, PING, to4H, ind4, rvolAt, vwapAt, replay, tradeOdds, summarize, pings, pingScore };
})(typeof RADAR !== 'undefined' ? RADAR : require('./radar.js'));
if (typeof module !== 'undefined') module.exports = SETUPS;
