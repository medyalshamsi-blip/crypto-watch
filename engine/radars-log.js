// 24/7 log for the Test tab's two radars (sweep & Wyckoff, order flow). Called by setups-log.js every hour with
// the 20 days of closed Binance 15m candles it already loaded. Every hit is appended once to data/radars/<day>.jsonl
// with the time it was first seen; a hit seen within 3 hours of its candle's close counts as live (proof of no hindsight),
// older ones are backfill. data/radars.json holds the live record and the last-20-days replay. Read-only. Not financial advice.
const fs = require('fs');
const path = require('path');
const R2 = require('./radars2.js');

const DIR = path.join(__dirname, '..', 'data', 'radars'), OUT = path.join(__dirname, '..', 'data', 'radars.json');
const DAY = 864e5, LIVE_LAG = 3 * 3600e3, MIN = { sweep: 5, flow: 3 };   // sweep hits below 5 are too many to log (hundreds a day)
const dayOf = t => new Date(t).toISOString().slice(0, 10);
function readDays(since) {
  if (!fs.existsSync(DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort()) {
    if (since != null && f.slice(0, 10) < dayOf(since)) continue;
    for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) if (line.trim()) { try { out.push(JSON.parse(line)); } catch (e) { /* skip a broken line */ } }
  }
  return out;
}

function run(data, wl, now = Date.now()) {
  const first = !fs.existsSync(DIR) || !fs.readdirSync(DIR).some(f => f.endsWith('.jsonl'));
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const liveSince = prev.liveSince ? Date.parse(prev.liveSince) : now;
  const known = new Set(readDays(now - 25 * DAY).map(e => e.id));
  const series = {}, fresh = [], sets = { sweep: [], flow: [] };
  for (const [s, d] of Object.entries(data)) {
    if (!d || !d.tb || d.t.length < 300) continue;
    const coin = s.replace(/USDT$/, ''), n = d.t.length;           // setups-log loads closed candles only
    let r; try { r = R2.scan(d, n); } catch (e) { console.log('radars', s, e.message); continue; }
    series[coin] = { '15m': [d, n], '1H': [r.h1, r.h1.t.length], '4H': [r.h4, r.h4.t.length] };
    for (const [radar, list] of [['sweep', r.sweep], ['flow', r.flow]]) {
      for (const tf of ['15m', '1H', '4H']) { const [m, k] = series[coin][tf]; if (radar === 'flow' && tf === '4H') continue; sets[radar].push({ m, n: k, tf, hits: list.filter(h => h.tf === tf) }); }
      for (const h of list) {
        if (h.score < MIN[radar]) continue;
        const close = h.t + R2.TF_MS[h.tf], id = [coin, radar, h.tf, h.t, h.side, h.kind].join('|');
        if (known.has(id)) continue; known.add(id);
        const e = { id, t: h.t, close, seen: now, coin, wl: wl.has(s) || undefined, radar, tf: h.tf, side: h.side, kind: h.kind, score: h.score, tags: h.tags, entry: +h.entry.toPrecision(6), stop: +h.stop.toPrecision(6) };
        if (first || now - close > LIVE_LAG) e.backfill = true;
        fresh.push(e);
      }
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const byDay = {}; for (const e of fresh) (byDay[dayOf(e.t)] = byDay[dayOf(e.t)] || []).push(e);
  for (const [dd, list] of Object.entries(byDay)) fs.appendFileSync(path.join(DIR, dd + '.jsonl'), list.sort((a, b) => a.t - b.t).map(e => JSON.stringify(e)).join('\n') + '\n');

  // live record: outcomes of hits first seen live, from the candles loaded now
  const all = readDays(now - 21 * DAY), z = () => ({ n: 0, up5: 0, dn5: 0, upFirst: 0, dnFirst: 0, closeUp: 0 });
  const add = (b, oc) => { b.n++; if (oc.up5) b.up5++; if (oc.dn5) b.dn5++; if (oc.first === 1) b.upFirst++; if (oc.first === -1) b.dnFirst++; if (oc.ret > 0) b.closeUp++; };
  const live = { sweep: { bull: z(), bear: z() }, flow: { bull: z(), bear: z() }, base: z(), pending: 0 };
  for (const e of all) {
    if (e.backfill || e.close < liveSince) continue;
    const sr = series[e.coin] && series[e.coin][e.tf]; if (!sr) continue;
    const [m, k] = sr, j = m.t.indexOf(e.t); if (j < 0) continue;
    const oc = R2.outcome(m, k, j, e.tf); if (!oc || !oc.done) { live.pending++; continue; }
    add(live[e.radar][e.side > 0 ? 'bull' : 'bear'], oc);
  }
  for (const c of Object.keys(series)) { const [m, k] = series[c]['1H']; for (let j = 0; j < k; j++) { if (m.t[j] < liveSince) continue; const oc = R2.outcome(m, k, j, '1H'); if (oc && oc.done) add(live.base, oc); } }
  const pct = b => Object.assign(b, { up5Pct: b.n ? +(100 * b.up5 / b.n).toFixed(1) : null, dn5Pct: b.n ? +(100 * b.dn5 / b.n).toFixed(1) : null, upFirstPct: b.n ? +(100 * b.upFirst / b.n).toFixed(1) : null, dnFirstPct: b.n ? +(100 * b.dnFirst / b.n).toFixed(1) : null, closeUpPct: b.n ? +(100 * b.closeUp / b.n).toFixed(1) : null });
  for (const r of ['sweep', 'flow']) { pct(live[r].bull); pct(live[r].bear); live[r].base = live.base; } pct(live.base);
  const doc = {
    about: 'Written by engine/radars-log.js inside the hourly setups job: the Test tab\'s sweep & Wyckoff radar and order-flow radar on closed Binance 15m candles (1H and 4H built from them). Outcome: +5% or -5% first within 6 hours (4H: 24 hours) and the close after. Read-only. Not financial advice.',
    updated: new Date(now).toISOString(), liveSince: new Date(liveSince).toISOString(), coins: Object.keys(series).length, minScore: MIN, rules: R2.P,
    live, last20Days: { sweep: R2.track(sets.sweep, MIN.sweep), flow: R2.track(sets.flow, MIN.flow) },
    recent: all.filter(e => e.close >= now - DAY).sort((a, b) => b.close - a.close || b.score - a.score).slice(0, 80)
  };
  fs.writeFileSync(OUT, JSON.stringify(doc) + '\n');
  console.log(`radars: ${doc.coins} coins, ${fresh.length} new hits${first ? ' (first run: backfill)' : ''}; live finished sweep ${live.sweep.bull.n + live.sweep.bear.n}, flow ${live.flow.bull.n + live.flow.bear.n}, pending ${live.pending}`);
  return doc;
}
module.exports = { run };
