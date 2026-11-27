"""Prints the alarms raised since the previous hourly relay run, for the Claude scheduled task.
Usage: python3 engine/relay.py MINUTE   (MINUTE = the minute past the hour the relay runs at)
Each run covers the hour that ended at its own scheduled time, so a late run neither repeats nor skips alarms."""
import json, sys, os, datetime as dt
minute = int(sys.argv[1]) if len(sys.argv) > 1 else 0
now = dt.datetime.fromisoformat(os.environ['RELAY_NOW']) if os.environ.get('RELAY_NOW') else dt.datetime.now(dt.timezone.utc)   # RELAY_NOW: tests only
slot = now.replace(minute=minute, second=0, microsecond=0)
if slot > now: slot -= dt.timedelta(hours=1)
start = slot - dt.timedelta(hours=1)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'alarms.json')
if not os.path.exists(path):
    print('Crypto alarms: the engine has not written its first results yet.'); sys.exit()
doc = json.load(open(path))
ts = lambda s: dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
new = [a for a in doc.get('alerts', []) if start <= ts(a['at']) < slot]
# breakout setups from engine/setups-log.js: paper entries and exits on any coin, breakouts and early warnings on the watchlist
spath = os.path.join(os.path.dirname(path), 'setups.json')
setup_lines = []
if os.path.exists(spath):
    sdoc = json.load(open(spath)); fp = lambda x: f'{x:,.2f}' if x >= 100 else f'{x:.4g}'
    ms = lambda d: dt.datetime.fromtimestamp(d / 1000, dt.timezone.utc)
    for e in sorted(sdoc.get('latest', []), key=lambda e: e['t']):
        if e.get('backfill') or not (start <= ms(e['seen']) < slot): continue
        c, ty = e['coin'], e['type']
        if ty == 'entry': setup_lines.append(f"• {c} paper entry {fp(e['entry'])} after a retest (stop {fp(e['stop'])}, target {fp(e['target'])}, +2R after costs{'; full strategy' if e.get('full') else ''})")
        elif ty == 'exit': setup_lines.append(f"• {c} paper trade closed ({e['why']}): {e['r']:+.2f}R")
        elif ty == 'breakout' and e['vm'] >= 1.5 and (e.get('wl') or e.get('fullAt')): setup_lines.append(f"• {c} broke the 4H ceiling {fp(e['lv'])} on {e['vm']:.1f}× volume{' after a full early warning' if e.get('fullAt') else ''}; wait for the retest")
        elif ty == 'warn-full' and e.get('wl'): setup_lines.append(f"• {c} early warning: {e['dist']:.2f} ATR under the 4H ceiling {fp(e['lv'])}")
lines = []
beat = doc.get('lastSuccess')
if not beat or now - ts(beat) > dt.timedelta(hours=4):
    if slot.hour % 6 == 0:                      # say it every 6 hours, not every hour
        lines.append('Crypto alarms: the engine has not read Binance since ' + (beat or 'it started') + ' UTC. Check the Actions tab of the crypto-watch repository.')
if new:
    new.sort(key=lambda a: (not a.get('strong'), not a.get('focus'), a['at']))
    lines.insert(0, f'Crypto alarms, {len(new)} new ({start:%H:%M}–{slot:%H:%M} UTC):')
    for a in new[:15]:
        lines.append(('‼ ' if a.get('strong') else '• ') + a['text'] + ('' if a.get('focus') else ' (rest list)'))
    if len(new) > 15: lines.append(f'…and {len(new) - 15} more in the dashboard.')
    lines.append('Not financial advice.')
if setup_lines:
    if lines and lines[-1] == 'Not financial advice.': lines.pop()
    lines.append(f'Breakout setups, {len(setup_lines)} new ({start:%H:%M}–{slot:%H:%M} UTC):'); lines += setup_lines[:12]
    if len(setup_lines) > 12: lines.append(f'…and {len(setup_lines) - 12} more on the dashboard.')
    lines.append('Paper trades only. Not financial advice.')
print('\n'.join(lines) if lines else 'No new alerts.')
