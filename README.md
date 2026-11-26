# Crypto watch

A read-only crypto dashboard in one page (`index.html`). It streams public Binance market data straight into your browser: no server, no keys, no orders. Holdings, settings and anything typed into Settings stay in each browser's own storage and are never written here.

## Radar and Simulate (Radar tab)
- The radar loads 7 days of 15-minute candles for every Binance USDT pair above the volume filter (stablecoins and leveraged tokens skipped), then follows them live on the WebSocket. A hit is a volume spike, a 24-bar range breakout, a structure break or a momentum turn on 1H or 15m, scored and listed with the reason.
- Backtest (150 coins, 1,000 hourly bars): a hit roughly doubles the odds of a 5% move within 6 hours, but up and down about equally, so a hit says "this coin is in play", not which way.
- Simulate runs 20,000 paths for the next 6 bars from the coin's own recent candles, stretched or shrunk by how far the most similar past moments across the market moved. It shows the predicted high, low and close with 80% ranges and its own track record. Sudden pumps can still go far past the range.

## 24/7 alarms
- `engine/alarms.js` runs on GitHub Actions every 15 minutes (`.github/workflows/alarms.yml`). It reads daily candles for the coins in `engine/coins.json` from Binance's public API, applies the same playbook rules as the dashboard, and writes new alarms to `data/alarms.json`.
- Alarms: a daily close through a bull or bear trigger, price trading through a trigger during the day, a volume spike of 2× or more, and a daily BoS / CHoCH or breakout.
- A Claude scheduled task reads `data/alarms.json` every hour (`engine/relay.py`) and pushes anything new to the Claude app on your phone. The dashboard shows the same list under "24/7 phone alarms".
- To change the coins the alarms watch, edit `engine/coins.json`. The dashboard's coin editor only changes the page in your browser.
- `engine/ta.js` is generated from the dashboard source; `engine/playbook.js` is the playbook scanner. Both are shared with the dashboard so the rules match.

Not financial advice.
