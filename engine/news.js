// Breaking-news rules shared by the dashboard and the GitHub news job.
// What a headline is about (impact type), which coins it names, and whether prices actually reacted.
// Read-only: it never trades and never posts anywhere. Not financial advice.
const NEWS = (() => {
  const SOURCES = [
    { id: 'binance-list', name: 'Binance listings', kind: 'binance', catalog: 48, official: true },
    { id: 'binance-delist', name: 'Binance delistings', kind: 'binance', catalog: 161, official: true },
    { id: 'coindesk', name: 'CoinDesk', kind: 'rss', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { id: 'theblock', name: 'The Block', kind: 'rss', url: 'https://www.theblock.co/rss.xml' },
    { id: 'cointelegraph', name: 'Cointelegraph', kind: 'rss', url: 'https://cointelegraph.com/rss' },
    { id: 'decrypt', name: 'Decrypt', kind: 'rss', url: 'https://decrypt.co/feed' },
    { id: 'cryptoslate', name: 'CryptoSlate', kind: 'rss', url: 'https://cryptoslate.com/feed/' },
    { id: 'cnbc', name: 'CNBC', kind: 'rss', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', macro: true },
    { id: 'cnbc-econ', name: 'CNBC Economy', kind: 'rss', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', macro: true },
    { id: 'cnbc-earn', name: 'CNBC Earnings', kind: 'rss', url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', macro: true },
    { id: 'fed', name: 'Federal Reserve', kind: 'rss', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', official: true, macro: true },
    { id: 'sec', name: 'SEC', kind: 'rss', url: 'https://www.sec.gov/news/pressreleases.rss', official: true }
  ];

  // Impact types. w: 3 = can move the whole market or a coin hard, 2 = often moves it, 1 = sometimes, 0 = commentary.
  // dir: what the type usually means for the named coin (+1 up, -1 down, 0 either way). The price check says what actually happened.
  const RULES = [
    { type: 'hack', label: 'Hack or exploit', w: 3, dir: -1, re: /\b(hack(ed|er|ers|s)?|exploit(ed|s)?|drain(ed|s)?|breach(ed)?|stolen|heist|compromised|rug ?pull(ed)?|attacker)\b/i },
    { type: 'depeg', label: 'Stablecoin off its peg', w: 3, dir: -1, re: /\b(de-?peg(ged|s|ging)?|(loses?|lost|regains?) (its |the )?peg)\b/i },
    { type: 'delist', label: 'Delisting', w: 3, dir: -1, re: /\b(delist(s|ed|ing)?|will (remove|cease)|monitoring tag|suspends? (trading|deposits|withdrawals)|halts? (trading|withdrawals|deposits)|withdrawals? (paused|halted|suspended|frozen))\b/i },
    { type: 'list', label: 'Listing', w: 2, dir: 1, re: /\b(will list|lists|listed on|to list|new listing|listing of|launchpool|launchpad|hodler airdrops?|adds? (support for|trading for)|(added|adds) to (the )?(roadmap|listing roadmap)|will add|spot trading (for|of)|KRW market|(Upbit|Bithumb|Coinbase|Robinhood|Binance|OKX|Bybit|Kraken)\b.{0,40}\badds?)\b/i },
    { type: 'etf', label: 'ETF', w: 2, dir: 0, re: /\bETFs?\b/ },
    { type: 'rates', label: 'Fed and rates', w: 2, dir: 0, re: /\b(Fed|FOMC|Federal Reserve|Powell|Warsh|rate (cut|cuts|hike|hikes|decision)|interest rates?|basis points?|monetary policy)\b/ },
    { type: 'data', label: 'Economic data', w: 2, dir: 0, re: /\b(CPI|PCE|PPI|inflation|jobs report|nonfarm|non-farm|payrolls|unemployment rate|GDP|retail sales|jobless claims)\b/i },
    { type: 'trade', label: 'Tariffs and trade', w: 2, dir: 0, re: /\b(tariffs?|trade war|trade deal|export controls?)\b/i },
    { type: 'geo', label: 'War and geopolitics', w: 2, dir: -1, re: /\b(war|missiles?|airstrikes?|invasion|invade[sd]?|ceasefire|military|troops|Arabian Gulf|Strait of Hormuz|sanctions?|nuclear)\b/i },
    { type: 'stocks', label: 'Stocks and big-tech earnings', w: 2, dir: 0, re: /\b(Nvidia|NVDA|earnings|quarterly (results|revenue)|revenue (beat|miss)|AI (stocks|trade|bubble)|Nasdaq|S&P 500|Dow|Wall Street|sell-?off|stock market|Magnificent Seven)\b/i },
    { type: 'legal', label: 'Regulation and courts', w: 2, dir: 0, re: /\b(SEC|CFTC|DOJ|Department of Justice|lawsuit|sues|sued|charge[sd]|indict(ed|ment)|settle(s|d|ment)|bans?|banned|regulators?|regulation|regulatory|bill|Senate|Congress|court|judge|MiCA|licen[cs]e[sd]?|crackdown|probe|investigation|executive order|White House)\b/ },
    { type: 'whale', label: 'Big buyers and sellers', w: 2, dir: 0, re: /\b(Strategy|MicroStrategy|Saylor|BlackRock|Mt\.? ?Gox|government wallet|moves? \$?[\d.,]+ ?(billion|million|bn|m)\b|whales?|treasury (firm|company|companies)|(buys|bought|sells|sold|acquires|acquired|dumps|dumped) [\d.,]+ ?(k |thousand |million |billion )?(BTC|ETH|SOL|bitcoin|ether))\b/i },
    { type: 'unlock', label: 'Token unlock', w: 2, dir: -1, re: /\b([Tt]oken [Uu]nlocks?|[Uu]nlocks? (of )?\$[\d.,]+ ?(million|billion|[mMB]|bn)|[Uu]nlock(s|ing)? [\d.,]+ ?(million|billion|[MB]|bn)? ?[A-Z]{2,10})\b/ },
    { type: 'flows', label: 'Flows and liquidations', w: 1, dir: 0, re: /\b(liquidat(ion|ions|ed)|inflows?|outflows?|open interest|short squeeze|funding rates?)\b/i },
    { type: 'upgrade', label: 'Upgrade or launch', w: 1, dir: 1, re: /\b(mainnet|upgrade|hard fork|hardfork|launch(es|ed)?|partnership|partners with|integrat(es|ion)|airdrop|token burn|buyback)\b/i }
  ];
  const DIGEST = /\b(opinion|podcast|newsletter|morning minute|daybook|week in review|weekly recap|the protocol:|price (prediction|analysis)|technical analysis|could (hit|reach|rally|drop|soar|crash)|here'?s (why|what|how)|what'?s next|analysts? (says?|predicts?|warns?)|eyes \$|explained|guide|how to)\b/i;
  const BIG_RATES = /\b(rate (cut|hike|decision)|cuts? rates|hikes? rates|holds? rates|FOMC (decision|statement|minutes)|emergency)\b/i;
  const BIG_ETF = /\b(approv(e|es|ed|al)|reject(s|ed|ion)?|den(y|ies|ied)|launch(es|ed)?|first day|record (inflows|outflows))\b/i;
  const BIG_STOCKS = /\b(Nvidia|NVDA)\b/i;

  // Coin names as they appear in headlines. "ctx" names are also ordinary words, so they count only next to a crypto word.
  const NAMES = {
    Bitcoin: 'BTC', BTC: 'BTC', Ethereum: 'ETH', Ether: 'ETH', Solana: 'SOL', Ripple: 'XRP', XRP: 'XRP', 'BNB Chain': 'BNB', BNB: 'BNB', Dogecoin: 'DOGE',
    Cardano: 'ADA', Tron: 'TRX', TRON: 'TRX', Toncoin: 'TON', Chainlink: 'LINK', Polkadot: 'DOT', Litecoin: 'LTC', 'Shiba Inu': 'SHIB', 'Bitcoin Cash': 'BCH',
    Uniswap: 'UNI', Aave: 'AAVE', Arbitrum: 'ARB', Aptos: 'APT', Sui: 'SUI', Sei: 'SEI', Celestia: 'TIA', Injective: 'INJ', Filecoin: 'FIL', 'Internet Computer': 'ICP',
    Algorand: 'ALGO', Hedera: 'HBAR', VeChain: 'VET', Bittensor: 'TAO', 'Fetch.ai': 'FET', 'Artificial Superintelligence Alliance': 'FET', Worldcoin: 'WLD', 'World Network': 'WLD',
    Ethena: 'ENA', 'ether.fi': 'ETHFI', EtherFi: 'ETHFI', LayerZero: 'ZRO', Initia: 'INIT', Illuvium: 'ILV', Notcoin: 'NOT', 'io.net': 'IO', Tellor: 'TRB', FTX: 'FTT',
    KernelDAO: 'KERNEL', Neiro: 'NEIRO', Bonk: 'BONK', 'Sahara AI': 'SAHARA', Horizen: 'ZEN', Zcash: 'ZEC', Conflux: 'CFX', Popcat: 'POPCAT', Ondo: 'ONDO',
    ChainGPT: 'CGPT', 'Pump.fun': 'PUMP', Virtuals: 'VIRTUAL', 'Virtuals Protocol': 'VIRTUAL', aixbt: 'AIXBT', Floki: 'FLOKI', Pepe: 'PEPE', Jasmy: 'JASMY', JasmyCoin: 'JASMY',
    Lido: 'LDO', 'The Graph': 'GRT', Kaito: 'KAITO', Mubarak: 'MUBARAK', Pendle: 'PENDLE', Jupiter: 'JUP', Pyth: 'PYTH', Wormhole: 'W', Starknet: 'STRK', zkSync: 'ZK',
    'Pudgy Penguins': 'PENGU', 'World Liberty Financial': 'WLFI', Hyperliquid: 'HYPE', 'Official Trump': 'TRUMP', Optimism: 'OP', Mantle: 'MNT', Immutable: 'IMX',
    'The Sandbox': 'SAND', Decentraland: 'MANA', 'Axie Infinity': 'AXS', Gala: 'GALA', ApeCoin: 'APE', Ronin: 'RON', Stacks: 'STX', Kaspa: 'KAS', Berachain: 'BERA',
    Plasma: 'XPL', Movement: 'MOVE', Story: 'IP', Near: 'NEAR', 'NEAR Protocol': 'NEAR', Render: 'RENDER', Stellar: 'XLM', Avalanche: 'AVAX', Cosmos: 'ATOM', Dash: 'DASH',
    Treasure: 'MAGIC', Orca: 'ORCA', Newton: 'NEWT', Polygon: 'POL', Maker: 'MKR', Sky: 'SKY', Celo: 'CELO', Flow: 'FLOW', 'Ethereum Classic': 'ETC'
  };
  const CTX_NAMES = new Set(['Near', 'Render', 'Stellar', 'Avalanche', 'Cosmos', 'Dash', 'Treasure', 'Orca', 'Newton', 'Story', 'Movement', 'Plasma', 'Optimism', 'Maker', 'Sky', 'Flow', 'Celo', 'Jupiter', 'Mantle', 'Gala', 'Stacks', 'Polygon', 'Immutable', 'Sei', 'Ondo', 'Kaito', 'Lido', 'Pyth', 'Ronin']);
  const CRYPTO_CTX = /\b(tokens?|coins?|memecoins?|crypto|cryptocurrency|blockchain|on-?chain|protocol|mainnet|testnet|DeFi|staking|airdrop|delist\w*|liquidity pools?|wallets?|DEX|stablecoins?|layer[- ]?[12]|L[12]|\$[A-Z]{2,})\b/i;
  // Uppercase words that are tickers on Binance but usually mean something else in a headline.
  const STOP = new Set(('AI ID OG ME IT AT IN ON OR US UK EU UN ARK NFP ONE ACT CITY DATA EDU FUN HIGH HOT KEY RED SIGN SUN WIN GAS BIO USUAL FIRST PEOPLE MAGIC BOND CAKE SAND MOVE NOT ' +
    'ETF ETFS SEC CEO CFO CTO USD USDT GDP CPI PCE PPI FED FOMC IPO DOJ NFT NFTS DAO DEX CEX TVL ATH API OTC IRS FBI UAE USA XAI COOKIE STORY SAGA PORTAL PIXEL RARE HOOK MASK MEME ' +
    'TURBO SUPER ANIME CHESS QUICK ORDER PROM ICE JOE DENT HARD LOKA ACE ALT BEL COS DEGO RAD REI SYN VIC NEW BANK OPEN TRUTH FORM HOME LINEA SOLV WAL AVAIL BARD PLUME ' +
    'NEWT TREE TOWNS SPK RESOLV HUMA ERA TOKEN SOON LAYER SHELL RAY JUP AUCTION GUN VANA AWE SIGN DOLO BREV ZKC ASTER MITO HEMI').split(' '));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let nameRe = null, nameList = [];
  function buildNames() {
    nameList = Object.keys(NAMES).filter(n => n.length >= 3 && !/^[A-Z0-9]+$/.test(n)).sort((a, b) => b.length - a.length);
    nameRe = new RegExp('(^|[^A-Za-z0-9$])(' + nameList.map(esc).join('|') + ')(?=$|[^A-Za-z0-9])', 'g');
  }
  buildNames();

  // Which coins a headline names. universe: Set of Binance base assets (USDT pairs). Returns tickers in order of appearance.
  function coins(text, universe) {
    const out = [], add = c => { if (c && (!universe || universe.has(c)) && !out.includes(c)) out.push(c); };
    let ctx = CRYPTO_CTX.test(text);
    if (!ctx) for (const m of text.matchAll(nameRe)) if (!CTX_NAMES.has(m[2])) { ctx = true; break; }   // another coin named nearby
    for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) add(m[1].toUpperCase());          // cashtags always count
    if (/\b(Official Trump|TRUMP (token|memecoin|coin)|Trump (memecoin|meme ?coin|token))\b/i.test(text)) add('TRUMP');
    for (const m of text.matchAll(nameRe)) { const n = m[2]; if (CTX_NAMES.has(n) && !ctx) continue; add(NAMES[n]); }
    for (const m of text.matchAll(/(^|[^A-Za-z0-9$])([A-Z][A-Z0-9]{2,9})(?=$|[^A-Za-z0-9])/g)) {      // TICKER in capitals, 3+ letters
      const t = m[2]; if (STOP.has(t) || /^\d/.test(t)) continue;
      if (NAMES[t]) { add(NAMES[t]); continue; }
      add(t);
    }
    for (const m of text.matchAll(/\(([A-Z0-9]{2,10})\)/g)) if (!STOP.has(m[1]) || ctx) add(m[1]);       // "Story (IP)" style
    return out.slice(0, 6);
  }

  // What kind of news it is, and how much it tends to matter.
  function classify(title, summary = '', src = {}) {
    const text = title;                                   // tags come from the headline only
    const hits = RULES.filter(r => r.re.test(title));
    let best = hits.reduce((a, r) => (!a || r.w > a.w) ? r : a, null);
    let w = best ? best.w : 0;
    if (best && best.type === 'list' && /delist/i.test(title)) { best = RULES.find(r => r.type === 'delist'); w = 3; }
    if (best && best.type === 'rates' && BIG_RATES.test(text)) w = 3;
    if (best && best.type === 'etf' && BIG_ETF.test(title)) w = 3;
    if (best && best.type === 'stocks' && BIG_STOCKS.test(title) && /\b(earnings|results|revenue|guidance|beat|miss)\b/i.test(text)) w = 3;
    if (best && best.type === 'data' && /\b(CPI|nonfarm|non-farm|payrolls|PCE)\b/i.test(title) && /\b(rises?|falls?|hotter|cooler|beats?|miss(es)?|unexpected|surges?|jumps?|slows?|eases?)\b/i.test(title)) w = 3;
    if (best && best.type === 'legal' && !/\b(crypto|bitcoin|token|coin|exchange|stablecoin|DeFi|Binance|Coinbase|ether|blockchain|digital asset)\b/i.test(text)) w = Math.min(w, 1);
    if (best && best.type === 'whale' && !/\b(bitcoin|BTC|ether|ETH|crypto|token|coin|SOL|XRP)\b/i.test(text)) w = 0;
    const crypto = CRYPTO_CTX.test(title) || /\b(bitcoin|BTC|ether|ethereum|ETH|solana|XRP|binance|coinbase|upbit|bithumb|robinhood|okx|bybit|kraken|tether|USDT|USDC|exchange)\b/i.test(title) || [...title.matchAll(nameRe)].some(m => !CTX_NAMES.has(m[2])) || /\$[A-Z]{2,}/.test(title);
    if (best && ['hack', 'unlock', 'depeg', 'delist', 'list'].includes(best.type) && !crypto && !src.official) w = 0;
    if (best && best.type === 'hack' && w > 1 && /\b(after|since|response|recover\w*|restor\w*|lifts?|resum\w*|returns?|refunds?|can freeze|security (group|firm|alliance)|bounty|sentenced|arrested|charged|lessons?)\b/i.test(title)) { w = 1; best = Object.assign({}, best, { label: 'Hack aftermath', dir: 0 }); }
    const digest = DIGEST.test(title) || /^(how|why|what|inside|explainer|here'?s)\b|\?\s*$/i.test(title.trim());
    if (digest) w = Math.max(0, Math.min(w, 2) - 1);
    if (src.official && w > 0) w = Math.min(3, w + (best && ['list', 'delist', 'rates'].includes(best.type) ? 0 : 1));
    return { type: best && w > 0 ? best.type : digest ? 'analysis' : 'other', label: best && w > 0 ? best.label : digest ? 'Commentary' : 'Other', w, dir: best && w > 0 ? best.dir : 0, digest, tags: hits.map(r => r.type) };
  }
  const MACRO = new Set(['rates', 'data', 'trade', 'geo', 'stocks', 'etf', 'legal', 'depeg', 'flows']);
  // Market-wide: macro types, or news about BTC/ETH/stablecoins with no smaller coin named.
  function isMarket(cls, cs) { return MACRO.has(cls.type) && (!cs.length || cs.every(c => ['BTC', 'ETH', 'USDT', 'USDC'].includes(c))) || (cs.length && cs.every(c => c === 'BTC' || c === 'ETH') && cls.w >= 2); }

  // Did prices react? bars: 15m candles [[t, o, h, l, c, v], ...] in time order. at: headline time (ms).
  const P = { look: 96, win: 4, x: 2.5, floorCoin: 0.01, floorBTC: 0.005, vol: 4, fade: 0.5 };
  function react(bars, at, now = Date.now(), opt = {}) {
    const p = Object.assign({}, P, opt), Q = 15 * 60e3;
    let i = -1; for (let k = bars.length - 1; k >= 0; k--) if (bars[k][0] <= at) { i = k; break; }
    if (i < 0 || at - bars[i][0] >= Q) return null;
    const base = bars[i][1], end = Math.min(bars.length - 1, i + p.win - 1), done = i + p.win - 1 <= bars.length - 1 && bars[i + p.win - 1][0] + Q <= now;
    const moves = [], vols = [];
    for (let j = Math.max(0, i - p.look); j + p.win - 1 < i; j++) { moves.push(Math.abs(bars[j + p.win - 1][4] / bars[j][1] - 1)); vols.push(bars[j][5]); }
    if (moves.length < 24) return null;
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
    const typ = Math.max(med(moves), 0.0015), vm = med(vols) || 1;
    let hi = base, lo = base; for (let j = i; j <= end; j++) { hi = Math.max(hi, bars[j][2]); lo = Math.min(lo, bars[j][3]); }
    const m = bars[end][4] / base - 1, up = hi / base - 1, dn = lo / base - 1, peak = Math.abs(up) >= Math.abs(dn) ? up : dn;
    const vr = (bars[i][5] + (bars[i + 1] ? bars[i + 1][5] : 0)) / (2 * vm);
    const floor = opt.btc ? p.floorBTC : p.floorCoin, need = Math.max(p.x * typ, floor);
    let status;
    if (Math.abs(m) >= need) status = 'confirmed';
    else if (Math.abs(peak) >= need && Math.abs(m) < p.fade * Math.abs(peak)) status = done ? 'faded' : 'pending';
    else if (vr >= p.vol && Math.abs(m) >= floor / 2) status = 'confirmed';
    else status = done ? 'muted' : 'pending';
    return { base, m, peak, typ, x: Math.abs(m) / typ, vr, status, done, mins: Math.round((Math.min(now, bars[end][0] + Q) - bars[i][0]) / 6e4) };
  }

  // Same story from several outlets: share most of the words and land within 3 hours.
  const WORDS = t => new Set(t.toLowerCase().replace(/[^a-z0-9$ ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|with|from|after|amid|into|over|says|said|this|that|its|has|have|will|are|was|new|why|how|what)$/.test(w)));
  function sameStory(a, b) {
    if (Math.abs(a.at - b.at) > 3 * 3600e3) return false;
    const A = WORDS(a.title), B = WORDS(b.title); let n = 0; for (const w of A) if (B.has(w)) n++;
    const cs = a.coins && b.coins && a.coins.length && a.coins.some(c => b.coins.includes(c)) && a.type === b.type && a.type !== 'other';
    return n / Math.max(1, Math.min(A.size, B.size)) >= 0.5 || (cs && n >= 3);
  }

  // Final ranking: impact type, official source, several outlets, the price check.
  function score(it) {
    let s = it.w;
    if (it.official) s += 0.5;
    if ((it.also || []).length) s += 0.5;
    if (it.urgent) s += 0.5;
    const r = it.react; if (r && r.status === 'confirmed') s += 1.5; else if (r && r.status === 'faded') s += 0.5; else if (r && r.status === 'muted' && it.w < 3) s -= 0.5;
    return Math.round(s * 10) / 10;
  }
  const BREAK_H = 3;
  const isBreaking = (it, now = Date.now()) => now - it.at < BREAK_H * 3600e3 && (it.w >= 3 || (it.w >= 2 && it.react && it.react.status === 'confirmed' && (!it.market || it.react.x >= 4)));
  // What the box lists: anything with an impact type, plus coin news that prices confirmed.
  const isShown = it => it.w >= 1 || (it.react && it.react.status === 'confirmed' && it.coins.some(c => c !== 'BTC' && c !== 'ETH'));

  // RSS / Atom without libraries.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  const dec = s => (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] !== undefined ? ENT[e] : m)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const tag = (x, n) => { const m = x.match(new RegExp('<' + n + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + n + '>', 'i')); return m ? m[1] : ''; };
  function parseFeed(xml) {
    const items = [], blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const b of blocks) {
      let link = dec(tag(b, 'link')); if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
      const when = dec(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
      const at = Date.parse(when);
      const title = dec(tag(b, 'title'));
      if (title && Number.isFinite(at)) items.push({ title, link, at, summary: dec(tag(b, 'description') || tag(b, 'summary')).slice(0, 400) });
    }
    return items;
  }
  // Headlines from TradingView's news tool (the Claude link). Accepts the usual shapes.
  function parseTV(payload) {
    const find = o => Array.isArray(o) ? o : o && typeof o === 'object' ? (o.items || o.news || o.headlines || o.data || o.result || null) : null;
    let arr = find(payload); if (arr && !Array.isArray(arr)) arr = find(arr);
    if (!arr && payload && payload.columns && payload.rows) arr = payload.rows.map(r => Object.fromEntries(payload.columns.map((c, k) => [c, r[k]])));
    return (arr || []).filter(x => x && x.title).map(x => ({
      title: String(x.title), link: x.link || (x.storyPath ? 'https://www.tradingview.com' + x.storyPath : ''),
      at: (x.published > 1e12 ? x.published : x.published * 1000) || Date.parse(x.published) || Date.now(), src: 'tv', srcName: x.provider ? String(x.provider).replace(/^./, c => c.toUpperCase()) : 'TradingView',
      urgent: x.urgency === 1, related: (x.relatedSymbols || []).map(s => String(s.symbol || s).split(':').pop().replace(/USDT?$|USD$|\.P$/, '')).filter(Boolean)
    }));
  }
  return { SOURCES, RULES, NAMES, P, BREAK_H, coins, classify, isMarket, react, sameStory, score, isBreaking, isShown, parseFeed, parseTV, dec };
})();
if (typeof module !== 'undefined') module.exports = NEWS;
