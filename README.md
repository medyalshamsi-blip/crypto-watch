# Crypto watch

A read-only crypto dashboard in one page (`index.html`). It streams public Binance market data straight into your browser: no server, no keys, no orders. Holdings, settings and anything typed into Settings stay in each browser's own storage and are never written here.

## Radar and Simulate (Radar tab)
- The radar loads 7 days of 15-minute candles for every Binance USDT pair above the volume filter (stablecoins and leveraged tokens skipped), then follows them live on the WebSocket. A hit is a volume spike, a 24-bar range breakout, a structure break or a momentum turn on 1H or 15m, scored and listed with the reason.
- Backtest (150 coins, 1,000 hourly bars): a hit roughly doubles the odds of a 5% move within 6 hours, but up and down about equally, so a hit says "this coin is in play", not which way.
- Simulate runs 20,000 paths for the next 6 bars from the coin's own recent candles, stretched or shrunk by how far the most similar past moments across the market moved. It shows the predicted high, low and close with 80% ranges and its own track record. Sudden pumps can still go far past the range.

## Breakout setups and the 24/7 setup log
- The Radar tab also tracks a breakout-and-retest strategy on about 20 days of 15m candles per coin: 4H early warnings (price within 1 ATR under the 4H ceiling, two rising 4H lows, a Bollinger BandWidth squeeze, volume 1.3× for the time of day), a 15m breakout on 1.5× volume, and a retest that closes back above the level (above session VWAP) for a paper entry with a stop under the retest low, a +2R target after costs and a 24-hour exit. Statuses: Near ceiling, Early warning, Breakout confirmed — awaiting retest, Paper entry qualified, Extended, Failed.
- `engine/setups.js` holds those rules (shared with the dashboard; `engine/radar.js` is the radar it builds on). `engine/setups-log.js` runs every hour on GitHub Actions (`.github/workflows/setups.yml`), replays the same rules with only data known at each 15m close, and appends every alert, breakout, retest and paper trade to `data/setups/<day>.jsonl`, with the time it was first logged. `data/setups.json` holds the current statuses and the scorecard: alerts that led to a spike, spikes warned in advance, lead time, paper-trade results, double slippage, and results by coin and BTC trend. The first run also writes about 20 days of replayed history, flagged as backfill.
- The hourly Claude relay adds new paper entries and exits, and breakouts and full early warnings on watchlist coins, to its phone message.

## 24/7 alarms
- `engine/alarms.js` runs on GitHub Actions every 15 minutes (`.github/workflows/alarms.yml`). It reads daily candles for the coins in `engine/coins.json` from Binance's public API, applies the same playbook rules as the dashboard, and writes new alarms to `data/alarms.json`.
- Alarms: a daily close through a bull or bear trigger, price trading through a trigger during the day, a volume spike of 2× or more, and a daily BoS / CHoCH or breakout.
- A Claude scheduled task reads `data/alarms.json` every hour (`engine/relay.py`) and pushes anything new to the Claude app on your phone. The dashboard shows the same list under "24/7 phone alarms".
- Telegram (optional): add two repository secrets yourself in GitHub (Settings > Secrets and variables > Actions): `TG_TOKEN` (the bot token from BotFather) and `TG_CHAT` (your chat id). The alarms job then sends one message per run for strong new alarms on the watchlist coins and checks Telegram's answer. With no secrets it sends nothing. The dashboard page no longer holds a token, because it loads scripts from other sites. An alarm is sent once: if Telegram is down at that moment it is not retried (it stays in `data/alarms.json` and in the hourly relay).
- To change the coins the alarms watch, edit `engine/coins.json`. The dashboard's coin editor only changes the page in your browser.
- `engine/ta.js` is generated from the dashboard source; `engine/playbook.js` is the playbook scanner. Both are shared with the dashboard so the rules match.

Not financial advice.
