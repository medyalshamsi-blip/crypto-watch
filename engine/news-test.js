// Replay test of the breaking-news price check. Run by hand on GitHub (news workflow, mode "test").
// 1) Past Binance and Upbit listing and delisting notices, 2) the headlines the free feeds hold now,
// 3) Nvidia's Q3 earnings on 17 Nov 2026. Each headline's first hour is compared with the same coins
// at random earlier times (the baseline), so "confirmed" can be read against chance. Read-only.
const fs = require('fs');
const path = require('path');
const NEWS = require('./news.js');
const { readSource, upbitTitle, fetchText, bin } = require('./news-log.js');

const OUT = path.join(__dirname, '..', 'data', 'news-test');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const cache = new Map();
async function bars(c, from) {             // 1000 15m candles from `from` (about 10.4 days)
  const k = c + "|" + from;
  if (cache.has(k)) return cache.get(k);
  let b = null;
  try { b = (await bin(`/api/v3/klines?symbol=${c}USDT&interval=15m&startTime=${from}&limit=1000`)).map(x => [x[0], +x[1], +x[2], +x[3], +x[4], +x[7]]); } catch (e) { b = null; }
  if (b && !b.length) b = null;
  cache.set(k, b); await sleep(60);
  return b;
}
async function check(c, at) {
  const b = await bars(c, Math.floor((at - 9.5 * 864e5) / 9e5) * 9e5);   // the headline sits ~22 h before the window ends
  return b ? NEWS.react(b, at, Date.now(), { btc: c === 'BTC' || c === 'ETH' }) : null;
}
async function baseline(c, at, n = 6) {    // same coin, random times 1–8 days before the headline
  const out = [];
  for (let k = 0; k < n; k++) { const t = at - (1 + rand() * 7) * 864e5; const r = await check(c, t); if (r && r.done) out.push(r); }
  return out;
}
function sum(rows) {
  const n = rows.length; if (!n) return { n: 0 };
  const share = s => Math.round(1000 * rows.filter(r => r.status === s).length / n) / 10;
  return { n, confirmed: share('confirmed'), faded: share('faded'), muted: share('muted'), medMove: Math.round(1e4 * med(rows.map(r => Math.abs(r.m)))) / 100, medX: Math.round(100 * med(rows.map(r => r.x))) / 100 };
}

async function main() {
  const now = Date.now();
  const tick = await bin('/api/v3/ticker/price');
  const universe = new Set(tick.map(t => t.symbol).filter(s => s.endsWith('USDT')).map(s => s.slice(0, -4)));
  const events = [];

  // 1) Past notices: Binance delistings (161), Binance listings (48), Upbit trading notices.
  for (const [cat, label] of [[161, 'binance-delist'], [48, 'binance-list']]) {
    for (let page = 1; page <= 8; page++) {
      try {
        const j = JSON.parse(await fetchText(`https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${cat}&pageNo=${page}&pageSize=20`));
        const d = j.data || {}, arts = (d.catalogs && d.catalogs[0] && d.catalogs[0].articles) || d.articles || [];
        if (!arts.length) break;
        for (const a of arts) events.push({ group: label, title: a.title, at: +a.releaseDate, official: true });
      } catch (e) { console.log(label, 'page', page, e.message); break; }
      await sleep(300);
    }
  }
  for (let page = 1; page <= 6; page++) {
    try {
      const j = JSON.parse(await fetchText(`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${page}&per_page=30&category=trade`));
      const list = (j.data && (j.data.notices || j.data.list)) || [];
      if (!list.length) break;
      for (const n of list) { const t = upbitTitle(n.title || ''); if (t) events.push({ group: /delist|caution/.test(t) ? 'upbit-delist' : 'upbit-list', title: t, at: Date.parse(n.listed_at || n.first_listed_at), official: true }); }
    } catch (e) { console.log('upbit page', page, e.message); break; }
    await sleep(300);
  }
  // 2) What the feeds hold right now.
  for (const s of NEWS.SOURCES.filter(s => s.kind === 'rss')) {
    try { for (const g of await readSource(s)) events.push({ group: 'feeds', src: s.id, title: g.title, at: g.at, official: !!s.official }); } catch (e) { console.log(s.id, e.message); }
  }
  // 3) Nvidia Q3 earnings, 17 Nov 2026, 16:20 New York = 21:20 UTC.
  const NV = Date.UTC(2026, 10, 17, 21, 20);

  const rows = [], base = {};
  for (const ev of events) {
    if (!Number.isFinite(ev.at) || now - ev.at < 75 * 6e4) continue;
    const cls = NEWS.classify(ev.title, '', ev), cs = NEWS.coins(ev.title, universe).slice(0, 3);
    const tgt = cs.length ? cs : (NEWS.isMarket(cls, cs) || cls.w >= 2) ? ['BTC'] : [];
    for (const c of tgt) {
      const r = await check(c, ev.at); if (!r || !r.done) continue;
      const g = ev.group === 'feeds' ? 'feeds w' + cls.w + (cs.length ? ' coin' : ' market') : ev.group;
      rows.push({ group: g, type: cls.type, w: cls.w, dir: cls.dir, c, at: new Date(ev.at).toISOString(), title: ev.title.slice(0, 140), m: r.m, peak: r.peak, x: r.x, vr: r.vr, status: r.status });
      (base[g] = base[g] || []).push(...await baseline(c, ev.at, ev.group === 'feeds' ? 3 : 4));
    }
  }
  const nv = [];
  for (const c of ['BTC', 'ETH', 'TAO', 'FET', 'RENDER', 'NEAR', 'WLD', 'ICP']) { const r = await check(c, NV); if (r) nv.push({ c, m: r.m, peak: r.peak, x: r.x, vr: r.vr, status: r.status }); }
  const nvBase = []; for (let d = 1; d <= 10; d++) { const r = await check('BTC', NV - d * 864e5); if (r) nvBase.push(r); }

  const groups = {};
  for (const g of [...new Set(rows.map(r => r.group))].sort()) {
    const rs = rows.filter(r => r.group === g), dirRows = rs.filter(r => r.dir && r.status === 'confirmed');
    groups[g] = { headlines: sum(rs), baseline: sum(base[g] || []), directionRight: dirRows.length ? Math.round(1000 * dirRows.filter(r => Math.sign(r.m) === r.dir).length / dirRows.length) / 10 : null, directionN: dirRows.length };
  }
  const out = { about: 'Replay of the breaking-news price check. Confirmed/faded/muted as in news.js; baseline = the same coins at random times 1–8 days earlier.', ran: new Date(now).toISOString(), groups, nvidia: { at: new Date(NV).toISOString(), coins: nv, btcSameHourOtherDays: sum(nvBase) }, counts: { events: events.length, checked: rows.length } };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(out, null, 1));
  const csv = ['group,type,w,dir,coin,at,status,move,peak,x,volume,title'].concat(rows.map(r => [r.group, r.type, r.w, r.dir, r.c, r.at, r.status, r.m.toFixed(4), r.peak.toFixed(4), r.x.toFixed(2), r.vr.toFixed(2), '"' + r.title.replace(/"/g, "'") + '"'].join(',')));
  fs.writeFileSync(path.join(OUT, 'headlines.csv'), csv.join('\n'));
  console.log(JSON.stringify(out, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
