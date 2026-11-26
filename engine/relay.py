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
print('\n'.join(lines) if lines else 'No new alerts.')
