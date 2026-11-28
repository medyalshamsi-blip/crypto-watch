'use strict';
// Synthetic-candle test of the volume-spike radar rules (no network): sessions and calendars, baseline, every stage, outcomes,
// and a no-look-ahead check (an event must be identical when everything after its close is cut off). Run: node engine/spike-radar2-synth-test.js
const fs = require('fs'), path = require('path');
const X = require('./spike-radar2.js');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'spike-radar2.config.json'), 'utf8'));
const { M15 } = X, t0 = Date.UTC(2026, 1, 15), N = 105 * 96, grid = X.buildGrid(CFG, t0, N), idx = s => { const v = (Date.parse(s) - t0) / M15; if (!Number.isInteger(v)) throw new Error('bad time ' + s); return v; };
let checks = 0; const fails = [];
const ok = (c, msg) => { checks++; if (!c) { fails.push(msg); console.log('FAIL: ' + msg); } };
const eq = (a, b, msg) => ok(Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9), `${msg}: got ${a}, want ${b}`);

// ---- 1. sessions, calendars, daylight saving (a grid that runs to the end of the year)
const gridL = X.buildGrid(CFG, t0, 320 * 96), lab = s => X.LABELS[gridL.lab[idx(s)]];
eq(lab('2026-06-16T00:00:00Z'), 'TYO', 'Tue 00:00 UTC summer = Tokyo open'); eq(lab('2026-06-16T06:15:00Z'), 'TYO', 'Tokyo last candle'); eq(lab('2026-06-16T06:30:00Z'), 'OFF-WKDY', 'between Tokyo close and London open (summer)');
eq(lab('2026-06-16T07:00:00Z'), 'LON', 'London open 08:00 BST'); eq(lab('2026-06-16T13:15:00Z'), 'LON', 'before the New York open'); eq(lab('2026-06-16T13:30:00Z'), 'LON-NY', 'overlap starts at the NY open (summer)');
eq(lab('2026-06-16T15:15:00Z'), 'LON-NY', 'last overlap candle (London closes 15:30 UTC)'); eq(lab('2026-06-16T15:30:00Z'), 'NY', 'NY alone after London closes'); eq(lab('2026-06-16T19:45:00Z'), 'NY', 'NY last candle (closes 20:00 UTC)'); eq(lab('2026-06-16T20:00:00Z'), 'OFF-WKDY', 'after NY close');
eq(lab('2026-12-01T08:00:00Z'), 'LON', 'London open in winter = 08:00 UTC'); eq(lab('2026-12-01T14:30:00Z'), 'LON-NY', 'overlap starts 14:30 UTC in winter'); eq(lab('2026-12-01T16:30:00Z'), 'NY', 'London closed 16:30 UTC winter');
eq(lab('2026-06-20T03:00:00Z'), 'OFF-WKND', 'Saturday'); eq(lab('2026-06-21T14:00:00Z'), 'OFF-WKND', 'Sunday has no cash session even when New York would be open on a weekday');
eq(lab('2026-11-26T15:00:00Z'), 'LON', 'US Thanksgiving: NYSE closed, London open'); eq(lab('2026-11-26T17:00:00Z'), 'OFF-WKDY', 'US Thanksgiving after London close');
eq(lab('2026-11-27T17:45:00Z'), 'NY', 'NYSE early close 13:00 ET = 18:00 UTC: last candle in'); eq(lab('2026-11-27T18:00:00Z'), 'OFF-WKDY', 'after the early close'); eq(gridL.early[idx('2026-11-27T15:00:00Z')], 1, 'early close flagged');
eq(lab('2026-11-23T01:00:00Z'), 'OFF-WKDY', 'Tokyo Labour Thanksgiving Day: Tokyo closed'); eq(lab('2026-04-29T01:00:00Z'), 'OFF-WKDY', 'Showa Day: Tokyo closed');
eq(lab('2026-04-03T15:00:00Z'), 'OFF-WKDY', 'Good Friday: London and New York closed'); eq(lab('2026-04-06T15:00:00Z'), 'NY', 'Easter Monday: London closed, NY open');
eq(lab('2026-12-24T12:15:00Z'), 'LON', 'LSE early close 12:30: last candle in'); eq(lab('2026-12-24T12:30:00Z'), 'OFF-WKDY', 'LSE after the early close');
eq(gridL.key[idx('2026-03-05T15:00:00Z')], gridL.key[idx('2026-03-10T14:00:00Z')], 'same New York clock (10:00) = same baseline slot across the US daylight-saving change');
ok(gridL.key[idx('2026-06-16T15:00:00Z')] !== gridL.key[idx('2026-06-16T15:30:00Z')], 'overlap and NY-only candles are different slots');
ok((gridL.tags[idx('2026-06-16T00:00:00Z')] & 1) !== 0 && (gridL.tags[idx('2026-06-16T06:15:00Z')] & 2) !== 0, 'Tokyo first and last hour tags'); ok((gridL.tags[idx('2026-06-16T07:00:00Z')] & 4) !== 0 && (gridL.tags[idx('2026-06-16T14:30:00Z')] & 8) !== 0, 'London first and last hour tags'); ok((gridL.tags[idx('2026-06-16T13:30:00Z')] & 16) !== 0 && (gridL.tags[idx('2026-06-16T19:45:00Z')] & 32) !== 0, 'New York first and last hour tags');
ok((gridL.tags[idx('2026-06-16T14:15:00Z')] & 8) === 0, 'London candle ending exactly 60 min before the close is not last hour');
eq(gridL.anchor[idx('2026-06-16T15:00:00Z')], idx('2026-06-16T13:30:00Z'), 'overlap VWAP anchored at the NY open'); eq(gridL.anchor[idx('2026-06-20T03:00:00Z')], idx('2026-06-20T00:00:00Z'), 'off-session VWAP anchored at UTC midnight'); eq(gridL.anchor[idx('2026-06-16T16:00:00Z')], idx('2026-06-16T13:30:00Z'), 'NY-only VWAP anchored at the NY open');

// ---- 2. indicator helpers against a direct calculation
{ const c = [44, 44.2, 43.9, 44.5, 44.8, 45.1, 44.7, 45.3, 45.9, 46.1, 45.8, 46.2, 45.9, 46.4, 46.8, 46.5]; let g = 0, l = 0; for (let i = 1; i <= 14; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= 14; l /= 14; const r14 = 100 - 100 / (1 + g / l);
  const d = c[15] - c[14], g2 = (g * 13 + Math.max(d, 0)) / 14, l2 = (l * 13 + Math.max(-d, 0)) / 14, r15 = 100 - 100 / (1 + g2 / l2), rs = X.rsiSeries(c, 14); eq(+rs[14].toFixed(8), +r14.toFixed(8), 'RSI first value'); eq(+rs[15].toFixed(8), +r15.toFixed(8), 'RSI Wilder smoothing'); ok(Number.isNaN(rs[13]), 'RSI starts at index 14');
  const e = (x, n) => { const a = 2 / (n + 1), o = [x[0]]; for (let i = 1; i < x.length; i++) o.push(a * x[i] + (1 - a) * o[i - 1]); return o; }, e12 = e(c, 12), e26 = e(c, 26), ln = e12.map((v, i) => v - e26[i]), sg = e(ln, 9), h = X.macdHist(c, 12, 26, 9); eq(h[15], ln[15] - sg[15], 'MACD histogram'); }

// ---- 3. outcomes
{ const n = 8, mk = () => new Float64Array(n).fill(100), g = { C: mk(), O: mk(), Hh: mk(), Ll: mk(), ok: new Uint8Array(n).fill(1), N: n };
  g.C[1] = 105.1; let o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[0], 1, 'O1 hit'); eq(o[1], 0, 'O2 needs the high above +5% (high is 100)'); g.Hh[1] = 105.1; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[1], 1, 'O2 hit'); eq(o[2], 1, 'O3 hit');
  g.C[1] = 104; g.Hh[1] = 105.5; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[0], 0, 'O1 miss (close only +4%)'); eq(o[1], 1, 'O2 hit on the high only'); eq(o[2], 0, 'O3 miss: four observed closes none above +5%');
  g.C[3] = 105.5; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[2], 1, 'O3 hit on the third close'); g.C[3] = 100; g.C[5] = 106; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[2], 0, 'a close on the fifth candle does not count');
  const e = X.outcomesAt(g, n - 2, n, 0.05, 4).o; eq(e[0], 0, 'last-but-one candle: next close observed'); eq(e[2], -1, 'O3 pending when fewer than four closes can be observed'); eq(X.outcomesAt(g, n - 1, n, 0.05, 4).o[0], -1, 'last candle: O1 pending');
  g.ok[2] = 0; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[2], -1, 'a missing candle among the next four leaves O3 pending'); g.ok[2] = 1; g.C[2] = 106; o = X.outcomesAt(g, 0, n, 0.05, 4).o; eq(o[2], 1, 'a hit is a hit even if later candles are unobserved');
  const h = mk(), g2 = { C: mk(), O: mk(), Hh: h, Ll: mk(), ok: new Uint8Array(n).fill(1), N: n }; g2.O[1] = 103; g2.C[1] = 108.2; g2.Hh[1] = 108.2; o = X.outcomesAt(g2, 0, n, 0.05, 4).o; eq(o[0], 1, 'O1 vs alert close'); eq(o[3], 1, 'N1 measured from the next open: 103 * 1.05 = 108.15 < 108.2'); g2.C[1] = 108.1; g2.Hh[1] = 108.1; o = X.outcomesAt(g2, 0, n, 0.05, 4).o; eq(o[0], 1, 'O1 still a hit from the alert close (108.1 > 105)'); eq(o[3], 0, 'N1 miss from the next open (108.1 < 108.15)'); g2.C[1] = 94.9; g2.Ll[1] = 94.9; o = X.outcomesAt(g2, 0, n, 0.05, 4).o; eq(o[6], 1, 'D1 mirror: close below -5%'); eq(o[7], 1, 'D2 mirror: low below -5%'); }

// ---- 4. the radar on engineered candles
const inc = new Float64Array(N).fill(0.004);
const SC = { S1: '2026-04-21T15:00:00Z', S2: '2026-04-22T15:00:00Z', S4: '2026-04-23T15:00:00Z', S5: '2026-04-24T15:00:00Z', S6: '2026-04-27T15:00:00Z', S7: '2026-04-28T15:00:00Z', S11: '2026-05-08T15:00:00Z', S12: '2026-05-12T15:00:00Z', S13: '2026-05-13T15:00:00Z', TYO: '2026-04-21T02:00:00Z', WKND: '2026-05-02T03:00:00Z', B1: '2026-05-07T11:00:00Z', B2: '2026-05-08T11:00:00Z' };
const I = Object.fromEntries(Object.entries(SC).map(([k, v]) => [k, idx(v)]));
for (const k of ['S1', 'S2', 'S4', 'S5', 'S6', 'S7', 'S12', 'S13']) for (let q = I[k] - 24; q < I[k]; q++) inc[q] += 0.03;      // run-up so the 1H RSI and MACD histogram pass
for (let q = I.S11 - 48; q < I.S11; q++) inc[q] -= 0.06;                                                                       // slide so they fail
const P = new Float64Array(N); P[0] = 100; for (let i = 1; i < N; i++) P[i] = P[i - 1] + inc[i];
function build(from) {
  const m = { t: [], o: [], h: [], l: [], c: [], q: [], tq: [] }, set = (i, o, h, l, c, tq) => { m.t[i - from] = t0 + i * M15; m.o[i - from] = o; m.h[i - from] = h; m.l[i - from] = l; m.c[i - from] = c; m.q[i - from] = 5000; m.tq[i - from] = tq; };
  for (let i = from; i < N; i++) set(i, P[i], P[i] + 0.3, P[i] - 0.3, P[i], 1000);
  return { m, set };
}
const { m: M, set } = build(0), p = i => P[i];
const brk = (i, tq, up = 1.9) => set(i, p(i), p(i) + up + 0.1, p(i) - 0.05, p(i) + up, tq);       // breakout candle: close in the top of the range, far above the previous highs
// varied history before S1 so the baseline is a real median
const key1 = grid.key[I.S1], hist = []; for (let i = I.S1 - 1; i >= 0 && hist.length < 20; i--) if (grid.key[i] === key1 && !grid.early[i]) hist.push(i);
hist.forEach((i, n) => { M.tq[i] = 600 + 50 * n; M.q[i] = 5000; });
const want = X.median(hist.map(i => M.tq[i]));
brk(I.S1, 4000);                                                                                   // S1: Watch + Priority same candle, passes 1H
brk(I.S2, 4000, 9);                                                                                // S2: about +7% candle: Late spike
brk(I.S4, 4000); { const b = p(I.S4) + 0.3; set(I.S4 + 1, p(I.S4) + 1.9, p(I.S4) + 2, b - 0.05, p(I.S4) + 1.5, 1000); }              // S4: retest next candle
brk(I.S5, 4000);                                                                                   // S5: falls back below the level
brk(I.S6, 4000); for (let k = 1; k <= 4; k++) set(I.S6 + k, p(I.S6) + 1.9, p(I.S6) + 2.2, p(I.S6) + 1.5, p(I.S6) + 2, 1000);          // S6: stays above, never touches: expires
brk(I.S7, 4000); set(I.S7 + 1, p(I.S7) + 1.9, p(I.S7) + 2.6, p(I.S7) + 1.8, p(I.S7) + 2.55, 4000);                                   // S7: second Priority while the first is pending
brk(I.S11, 4000);                                                                                  // S11: breakout after a slide: 1H filter fails
set(I.S12, p(I.S12), p(I.S12) + 0.3, p(I.S12) - 0.3, p(I.S12), 3500); brk(I.S12 + 3, 1000);       // S12: Watch now, Priority three closes later (not same candle)
set(I.S13, p(I.S13), p(I.S13) + 0.3, p(I.S13) - 0.3, p(I.S13), 3500); brk(I.S13 + 5, 1000);       // S13: Priority five closes later: too late
M.tq[I.TYO] = 5000; M.tq[I.WKND] = 3500; M.tq[I.B1] = 2999.9; M.tq[I.B2] = 3000;                    // session labels and the exact 3x boundary
const cfg = CFG, run = (m, c = cfg, name = 'SYN') => X.analyseCoin(name, m, grid, c, 0, N);
const res = run(M), at = (st, i, r = res) => r.events.find(e => e.stage === st && e.i === i);
let e = at('Watch', I.S1); ok(!!e, 'S1 Watch'); if (e) { eq(e.base, want, 'baseline = median of the previous 20 matching slots'); eq(e.mult, 4000 / want, 'buy-volume multiple'); eq(X.LABELS[e.lab], 'LON-NY', 'S1 session'); eq(e.late, false, 'S1 not late'); }
e = at('Priority', I.S1); ok(!!e, 'S1 Priority'); if (e) { ok(e.same, 'S1 Priority on the Watch candle'); ok(e.notified && e.notifiedB, 'S1 notification (1H RSI and MACD pass)'); ok(e.tracked, 'S1 tracked'); ok(e.bos < e.close && e.close > e.vwap, 'S1 close above the BoS and VWAP'); eq(e.bos, Math.max(...Array.from({ length: 8 }, (_, k) => M.h[I.S1 - 8 + k])), 'S1 BoS = highest high of the previous eight candles'); ok(e.rsi >= 50 && e.macdHist > 0, 'S1 1H values stored'); }
e = at('Fade', I.S1 + 1); ok(!!e && e.pNotified && e.pi === I.S1, 'S1 falls back below the BoS: Fade, linked to a notified Priority');
e = at('Watch', I.S2); ok(!!e && e.late, 'S2 Late spike flagged'); e = at('Priority', I.S2); ok(!!e && e.notified, 'S2 as written still notifies on a Late spike');
e = at('Retest', I.S4 + 1); ok(!!e && e.k === 1, 'S4 Retest: touched the level, closed above it and above VWAP'); ok(!at('Fade', I.S4 + 1) && !at('Fade', I.S4 + 2), 'S4 no Fade after a Retest (pending is cleared)');
ok(!!at('Fade', I.S5 + 1), 'S5 Fade'); e = at('Expired', I.S6 + 4); ok(!!e && e.k === 4, 'S6 Expired after four closes without touch or fade');
e = at('Priority', I.S7 + 1); ok(!!e && e.tracked === false && e.same, 'S7 second Priority is shown but not tracked'); e = at('Fade', I.S7 + 2); ok(!!e && e.pi === I.S7, 'S7 only the first Priority is tracked and fades');
e = at('Priority', I.S11); ok(!!e && e.same && !e.notified && !e.notifiedB, 'S11 1H filter blocks the notification'); ok(e && e.rsi < 50 && e.macdHist < 0, 'S11 1H RSI below 50 and MACD histogram below zero');
e = at('Priority', I.S12 + 3); ok(!!e && !e.same && e.watchAge === 3 && !e.notified, 'S12 Priority within four closes of a Watch, not notifying'); ok(!at('Priority', I.S13 + 5), 'S13 Priority five closes after the Watch does not count');
e = at('Watch', I.TYO); ok(!!e && X.LABELS[e.lab] === 'TYO', 'Tokyo session Watch'); e = at('Watch', I.WKND); ok(!!e && X.LABELS[e.lab] === 'OFF-WKND' && e.base === 1000, 'weekend candle matched on UTC time against weekend history'); ok(!at('Watch', I.B1) && !!at('Watch', I.B2), 'Watch needs at least 3.0x');
// rule changes flow through
{ const c1 = JSON.parse(JSON.stringify(cfg)); c1.rules.h1Filter = false; ok(at('Priority', I.S11, run(M, c1)).notified, 'h1Filter off notifies S11'); const c2 = JSON.parse(JSON.stringify(cfg)); c2.rules.watchMult = 5; ok(!at('Watch', I.S1, run(M, c2)), 'watchMult 5 removes a 4x Watch'); const c3 = JSON.parse(JSON.stringify(cfg)); c3.rules.minBaselineUSDT = 2000; ok(!at('Watch', I.S1, run(M, c3)), 'minimum baseline filters a 1,000 USDT baseline'); const c4 = JSON.parse(JSON.stringify(cfg)); c4.rules.newPriorityWhilePending = 'replace'; ok(at('Priority', I.S7 + 1, run(M, c4)).tracked, 'replace mode tracks the newer Priority'); }
// short history and missing candles are flagged, not guessed
{ const from = I.S1 - 3 * 96, b = build(from); b.set(I.S1, p(I.S1), p(I.S1) + 2, p(I.S1) - 0.05, p(I.S1) + 1.9, 4000);
  const r = X.analyseCoin('NEW', b.m, grid, cfg, 0, N); ok(!at('Watch', I.S1, r), 'a listing with three days of history gets no Watch (baseline needs 20 slots)'); ok(r.cov.noBaseline > 0 && r.cov.byLab[3].noBaseline > 0, 'insufficient history is counted'); }
{ const m2 = { t: [], o: [], h: [], l: [], c: [], q: [], tq: [] }; for (let i = 0; i < M.t.length; i++) if (i !== I.S1 - 1) for (const k of Object.keys(m2)) m2[k].push(M[k][i]);
  const r = run(m2); ok(!!at('Watch', I.S1, r) && !at('Priority', I.S1, r), 'a missing candle inside the eight-candle lookback blocks Priority instead of guessing'); ok(r.cov.missing >= 1, 'missing candle counted'); }
// early-close day candles stay out of the baseline
{ const day = idx('2026-11-27T15:00:00Z'); ok(gridL.early[day] === 1 && gridL.early[idx('2026-11-30T15:00:00Z')] === 0, 'early-close flag only on the half day'); }

// ---- 5. no look-ahead: cut everything after an event's close and the event must not change
function cutCheck(m, label, limit) {
  const full = run(m, cfg, label), fields = ['mult', 'base', 'tq', 'close', 'vwap', 'bos', 'late', 'same', 'notified', 'notifiedB', 'rsi', 'macdHist', 'rsiB', 'macdHistB', 'tracked', 'lab', 'tags', 'k', 'pi', 'pNotified', 'watchAge'];
  const pick = []; const byStage = {}; for (const ev of full.events) (byStage[ev.stage] = byStage[ev.stage] || []).push(ev);
  for (const st of Object.keys(byStage)) { const a = byStage[st], step = Math.max(1, Math.floor(a.length / Math.ceil(limit / 5))); for (let q = 0; q < a.length; q += step) pick.push(a[q]); }
  let n = 0; for (const ev of pick) { const cut = {}; for (const k of Object.keys(m)) cut[k] = m[k].slice(0, ev.i + 1); const r = run(cut, cfg, label), same = r.events.find(x => x.stage === ev.stage && x.i === ev.i);
    ok(!!same, `${label} ${ev.stage}@${ev.i} exists without the future`); if (same) for (const f of fields) if (!(Object.is(same[f], ev[f]) || (f in ev) === false)) { ok(false, `${label} ${ev.stage}@${ev.i} field ${f} changes when the future is removed: ${same[f]} vs ${ev[f]}`); break; } n++; }
  return { full, n, stages: Object.keys(byStage).map(s => `${s}:${byStage[s].length}`).join(' ') };
}
{ const s = cutCheck(M, 'engineered', 60); ok(s.n >= 20, 'engineered cut check ran on ' + s.n + ' events'); console.log('engineered', s.stages, 'checked', s.n); }
for (const seed of [11, 22, 33]) {
  let st = seed >>> 0; const rnd = () => (st = (st * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return (u - 3) / 0.7071; };
  const m = { t: [], o: [], h: [], l: [], c: [], q: [], tq: [] }; let px = 100;
  for (let i = 0; i < N; i++) { const spike = rnd() < 0.05, v = 1000 * Math.exp(0.4 * gauss()) * (spike ? 3 + 5 * rnd() : 1), jump = spike && rnd() < 0.6 ? 0.01 + 0.03 * rnd() : 0, o = px, c = px * (1 + 0.0015 * gauss() + jump), h = Math.max(o, c) * (1 + 0.001 * rnd()), l = Math.min(o, c) * (1 - 0.001 * rnd()); px = c; m.t.push(t0 + i * M15); m.o.push(o); m.h.push(h); m.l.push(l); m.c.push(c); m.q.push(v * 5); m.tq.push(v); }
  const s = cutCheck(m, 'fuzz' + seed, 80); ok(s.n >= 30, `fuzz ${seed} cut check ran on ${s.n} events`); console.log('fuzz', seed, s.stages, 'checked', s.n);
}
console.log(fails.length ? `${fails.length} FAILED of ${checks} checks` : `spike-radar2 synthetic test ok (${checks} checks)`); process.exit(fails.length ? 1 : 0);
