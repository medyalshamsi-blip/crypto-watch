// Breaking-news job: every 15 minutes on GitHub. Reads trusted free sources (Binance and Upbit notices,
// CoinDesk, The Block, Cointelegraph, Decrypt, Blockworks, CNBC, the Fed, the SEC), tags each headline
// with an impact type and the coins it names, checks Binance prices in the hour after it,
// and writes data/news.json for the dashboard. Read-only: no orders, no posting. Not financial advice.
const fs = require('fs');
const path = require('path');
const NEWS = require('./news.js');

const OUT = path.join(__dirname, '..', 'data', 'news.json');
const KEEP_DAYS = 7, CHECK_H = 48, MAX_ITEMS = 300;
const UA = 'crypto-watch news reader (github.com/medyalshamsi-blip/crypto-watch; read-only)';
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];

async function fetchText(url, ms = 20000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, application/json, text/xml, */*' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}
async function bin(p) {
  let err;
  for (const h of HOSTS) {
    try { const r = await fetch(h + p, { signal: AbortSignal.timeout(20000) }); if (r.ok) return r.json(); err = new Error('HTTP ' + r.status); } catch (e) { err = e; }
  }
  throw err;
}
const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

// Upbit notices are in Korean; only trading notices are kept and given an English title.
function upbitTitle(t) {
  const tick = [...t.matchAll(/\(([A-Z0-9]{2,12})\)/g)].map(m => m[1]);
  if (!tick.length) return null;
  const list = tick.join(', ');
  if (/거래지원\s*종료/.test(t)) return `Upbit will end trading for ${list} (delisting)`;
  if (/유의\s*종목\s*지정/.test(t) && !/해제/.test(t)) return `Upbit puts ${list} on its caution list (delisting risk)`;
  if (/유의\s*종목.*해제/.test(t)) return `Upbit lifts the caution flag on ${list}`;
  if (/디지털\s*자산\s*추가|마켓\s*추가|신규\s*거래지원/.test(t)) { const mk = (t.match(/(KRW|BTC|USDT)(\s*,\s*(KRW|BTC|USDT))*\s*마켓/) || [''])[0].replace('마켓', 'market').trim(); return `Upbit adds ${list} to its ${mk || 'markets'} (listing)`; }
  return null;
}

async function readSource(s) {
  if (s.kind === 'rss') return NEWS.parseFeed(await fetchText(s.url));
  if (s.kind === 'binance') {
    const urls = [
      `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${s.catalog}&pageNo=1&pageSize=20`,
      `https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=${s.catalog}&pageNo=1&pageSize=20`
    ];
    let err;
    for (const u of urls) {
      try {
        const j = JSON.parse(await fetchText(u)), d = j.data || {};
        const arts = (d.catalogs && d.catalogs[0] && d.catalogs[0].articles) || d.articles || [];
        if (!arts.length) { err = new Error('no articles'); continue; }
        return arts.map(a => ({ title: a.title, link: 'https://www.binance.com/en/support/announcement/detail/' + a.code, at: +a.releaseDate || Date.parse(a.releaseDate) })).filter(a => a.title && a.at);
      } catch (e) { err = e; }
    }
    throw err;
  }
  if (s.kind === 'upbit') {
    const j = JSON.parse(await fetchText('https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=30&category=trade'));
    const list = (j.data && (j.data.notices || j.data.list)) || [];
    return list.map(n => ({ title: upbitTitle(n.title || ''), raw: n.title, link: 'https://upbit.com/service_center/notice?id=' + n.id, at: Date.parse(n.listed_at || n.first_listed_at || n.created_at) })).filter(n => n.title && n.at);
  }
  return [];
}

async function main() {
  const now = Date.now();
  let prev = { items: [] };
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
  const items = (prev.items || []).filter(it => now - it.at < KEEP_DAYS * 86400e3);
  const seen = new Set(items.map(it => it.id));

  // Rules improve over time: tag the kept headlines again with the current rules (their price checks stay).
  for (const it of items) {
    const cls = NEWS.classify(it.title, '', { official: it.official });
    const cs = NEWS.coins(it.title, prev.universe ? new Set(prev.universe) : null);
    for (const a of it.also || []) { /* repeats keep the lead's tags */ }
    Object.assign(it, { type: cls.type, label: cls.label, w: cls.w, dir: cls.dir, coins: cs.length ? cs : it.coins, market: NEWS.isMarket(cls, cs) });
    if (!it.market && !it.coins.length && it.reacts) { delete it.reacts; it.react = null; }
  }

  // Coins that trade against USDT on Binance.
  let universe = new Set(prev.universe || []);
  try {
    const tick = await bin('/api/v3/ticker/price');
    const u = new Set(tick.map(t => t.symbol).filter(s => s.endsWith('USDT')).map(s => s.slice(0, -4)).filter(b => !/^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|EUR|AEUR|EURI|XUSD|USD1|BFUSD)$/.test(b)));
    if (u.size > 100) universe = u;
  } catch (e) { console.log('coin list:', e.message); }

  // Read every source; one failing source never stops the rest.
  const status = {};
  const fresh = [];
  await Promise.all(NEWS.SOURCES.map(async s => {
    const t0 = Date.now();
    try {
      const got = await readSource(s);
      status[s.id] = { name: s.name, ok: true, n: got.length, newest: got.length ? new Date(Math.max(...got.map(g => g.at))).toISOString() : null, ms: Date.now() - t0 };
      for (const g of got) fresh.push(Object.assign(g, { src: s.id, srcName: s.name, official: !!s.official, macro: !!s.macro }));
    } catch (e) {
      status[s.id] = { name: s.name, ok: false, err: String(e.message || e).slice(0, 120), ms: Date.now() - t0 };
    }
  }));

  // Tag new headlines; fold repeats of the same story into the first one.
  fresh.sort((a, b) => a.at - b.at);
  let added = 0;
  for (const g of fresh) {
    if (now - g.at > KEEP_DAYS * 86400e3 || g.at > now + 3600e3) continue;
    const id = hash(g.src + '|' + (g.link || g.title));
    if (seen.has(id)) continue;
    seen.add(id);
    const cls = NEWS.classify(g.title, g.summary, g);
    const cs = NEWS.coins(g.title, universe);
    const market = NEWS.isMarket(cls, cs);
    if (cls.w === 0 && !cs.length) continue;                       // no impact type and no coin: not for this box
    if (cls.digest && !cs.length) continue;
    const it = { id, src: g.src, srcName: g.srcName, title: g.title, link: g.link, at: g.at, summary: (g.summary || '').slice(0, 220), coins: cs, market, type: cls.type, label: cls.label, w: cls.w, dir: cls.dir, official: g.official, also: [] };
    const lead = items.find(x => x.src !== it.src && NEWS.sameStory(x, it));
    if (lead) {
      if (!lead.also.some(a => a.src === it.src)) lead.also.push({ src: it.src, name: it.srcName, link: it.link, at: it.at });
      if (it.at < lead.at) lead.at = it.at;
      if (it.w > lead.w) Object.assign(lead, { type: it.type, label: it.label, w: it.w, dir: it.dir });
      for (const c of it.coins) if (!lead.coins.includes(c)) lead.coins.push(c);
      continue;
    }
    items.push(it); added++;
  }

  // Price check: Binance 15m candles in the hour after each headline of the last 48 hours.
  const want = new Map();
  for (const it of items) {
    if (now - it.at > CHECK_H * 3600e3 || (it.reacts && it.reacts.length && it.reacts.every(r => r.done))) continue;
    const cs = it.coins.filter(c => universe.has(c)).slice(0, 3);
    it.check = cs.length ? cs : it.market ? ['BTC'] : [];   // coin news with no Binance coin gets no check
    for (const c of it.check) want.set(c, Math.min(want.get(c) || Infinity, it.at));
  }
  const bars = {};
  for (const [c, t] of want) {
    try { bars[c] = (await bin(`/api/v3/klines?symbol=${c}USDT&interval=15m&startTime=${t - 26 * 3600e3}&limit=1000`)).map(k => [k[0], +k[1], +k[2], +k[3], +k[4], +k[7]]); } catch (e) { bars[c] = null; }
  }
  const rnd = (x, d = 5) => Math.round(x * 10 ** d) / 10 ** d;
  for (const it of items) {
    if (!it.check) continue;
    const reacts = [];
    for (const c of it.check) {
      const b = bars[c]; if (!b) continue;
      const r = NEWS.react(b, it.at, now, { btc: c === 'BTC' || c === 'ETH' });
      if (r) reacts.push({ c, m: rnd(r.m), peak: rnd(r.peak), typ: rnd(r.typ), x: rnd(r.x, 2), vr: rnd(r.vr, 2), status: r.status, done: r.done, mins: r.mins });
    }
    if (reacts.length) it.reacts = reacts;
    delete it.check;
  }
  const order = { confirmed: 3, faded: 2, pending: 1, muted: 0 };
  for (const it of items) {
    it.react = it.reacts && it.reacts.slice().sort((a, b) => order[b.status] - order[a.status] || b.x - a.x)[0] || null;
    it.score = NEWS.score(it);
  }
  items.sort((a, b) => b.at - a.at);
  const out = {
    about: 'Breaking news for the dashboard: trusted free sources, impact type, coins named, and the Binance price check in the hour after each headline. Read-only. Not financial advice.',
    updated: new Date(now).toISOString(),
    rules: {
      breakingHours: NEWS.BREAK_H,
      impact: '3 = can move the market or a coin hard (hack, delisting, stablecoin off its peg, Fed decision, CPI or payrolls surprise, ETF approval, Nvidia earnings); 2 = often moves it; 1 = sometimes; 0 = commentary',
      priceCheck: 'Binance 15m candles in the first hour after the headline, against the coin\'s usual 1-hour move over the previous day. Confirmed: moved at least 2.5 times its usual hour and at least 1% (BTC and ETH 0.5%), or traded 4 times its usual volume. Faded: moved that much, then gave back more than half within the hour. Muted: no such move.'
    },
    sources: status,
    universe: [...universe].sort(),
    items: items.slice(0, MAX_ITEMS)
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const okN = Object.values(status).filter(s => s.ok).length;
  console.log(`sources ${okN}/${NEWS.SOURCES.length}; new headlines ${added}; kept ${out.items.length}; price checks on ${want.size} coins`);
  for (const [k, s] of Object.entries(status)) console.log(' ', k.padEnd(15), s.ok ? `ok ${s.n} items, newest ${s.newest}` : 'FAILED ' + s.err);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { readSource, upbitTitle, fetchText, bin, hash };
