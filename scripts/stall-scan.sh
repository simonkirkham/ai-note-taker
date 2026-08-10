#!/usr/bin/env bash
# Find every point the human had to poke a stalled session, and why it stalled.
#
#   scripts/stall-scan.sh          the last 24 hours
#   scripts/stall-scan.sh 168      the last week
#   scripts/stall-scan.sh all      the whole history
#
# The counterpart to the permission hook. That captures interruptions where the
# agent ASKED for something; this captures the opposite — the human stepping in
# because nothing was asked and nothing was happening. Those do not look like
# questions, so the transcript scan in `human-input-log` capture mode misses
# them entirely: the log held 1 such row where the real count was 22.
#
# Read-only. Reads local transcripts. Nothing written, nothing sent.
set -euo pipefail

WINDOW="${1:-24}"
REPO="$(git rev-parse --show-toplevel)"

REPO="$REPO" WINDOW="$WINDOW" python3 - <<'PY'
import json, os, glob, re, time, collections

repo   = os.environ['REPO']
window = os.environ['WINDOW']
cutoff = 0 if window == 'all' else time.time() - float(window) * 3600

slug = re.sub(r'[/.]', '-', repo)
tdir = os.path.expanduser(f'~/.claude/projects/{slug}')

def text_of(msg):
    c = msg.get('content')
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        out = []
        for b in c:
            if isinstance(b, dict):
                if b.get('type') == 'text':
                    out.append(b.get('text', ''))
                elif b.get('type') == 'tool_result':
                    return None          # a tool result, not something the human typed
        return '\n'.join(out)
    return None

NOISE = ('<system-reminder>', '<command-name>', 'Caveat:', '<local-command',
         '<user-prompt-submit-hook>', '[Request interrupted')

# What a nudge looks like: short, and carrying no instruction of its own.
NUDGE = re.compile(r'''^\s*(
      (please\s+)?(carry\s+on|continue|keep\s+going|keep\s+driving|go\s+on|proceed)
    | (any\s+)?(update|progress|news)
    | still\s+(going|there|running|working)
    | what.?s\s+(happening|going\s+on|the\s+status)
    | why\s+(did|have)\s+you\s+stop(ped)?
    | are\s+you\s+(still\s+)?(there|going|working)
    | (is\s+it|you)\s+done
    | anything\s+(remaining|left|else)
    | don.?t\s+stop | finish\s+(it|up) | resume
    | and | \?+ | next | go | yes | ok
    )\s*[.!?]*\s*$''', re.I | re.X)

# Why it stalled — read from what the agent said immediately before.
def cause(tail):
    t = tail[-600:]
    if 'API Error' in t:
        return 'connection died mid-reply'
    if re.search(r'(want me to|shall i|would you like me to|or stop here|say the word)[^.]{0,60}[?]?\s*$', t, re.I):
        return 'asked permission to continue agreed work'
    if re.search(r"(i'?ll |i will |moving to |waiting on |next[:,] |then i)", t[-300:], re.I):
        return 'stated what it would do next, then stopped'
    if re.search(r'(anything remaining|nothing else is running|outstanding)', t, re.I):
        return 'unclear whether it had finished'
    return 'went quiet mid-work'

found = []
for f in glob.glob(os.path.join(tdir, '*.jsonl')):
    if os.path.getmtime(f) < cutoff:
        continue
    prev, prev_ts = '', None
    for line in open(f, errors='replace'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('type') == 'assistant':
            tx = text_of(r.get('message', {}))
            if tx:
                prev, prev_ts = tx, r.get('timestamp')
        elif r.get('type') == 'user':
            tx = (text_of(r.get('message', {})) or '').strip()
            if not tx or any(n in tx for n in NOISE) or len(tx) > 120:
                continue
            if NUDGE.match(tx):
                gap = None
                if prev_ts and r.get('timestamp'):
                    try:
                        import datetime
                        p = datetime.datetime.fromisoformat(prev_ts.replace('Z', '+00:00'))
                        n = datetime.datetime.fromisoformat(r['timestamp'].replace('Z', '+00:00'))
                        gap = (n - p).total_seconds() / 60
                    except Exception:
                        pass
                found.append({'session': os.path.basename(f)[:8], 'said': tx[:60],
                              'cause': cause(prev), 'gap': gap})

label = 'all time' if window == 'all' else f'last {window}h'
print()
print(f'STALLS — the human restarting a stopped session ({label})')
print('─' * 74)
if not found:
    print('  none — nothing needed a nudge')
    print()
    raise SystemExit(0)

by = collections.Counter(f['cause'] for f in found)
for c, n in by.most_common():
    print(f'  {n:>3}  {c}')
gaps = sorted(f['gap'] for f in found if f['gap'] is not None)
if gaps:
    print(f'\n  waited before poking: median {gaps[len(gaps)//2]:.0f} min, worst {max(gaps):.0f} min')
print(f'\n  {len(found)} total\n')

print('DETAIL')
print('─' * 74)
for f in sorted(found, key=lambda x: -(x['gap'] or 0)):
    g = f'{f["gap"]:.0f}m' if f['gap'] is not None else '  ?'
    print(f'  {g:>6}  {f["session"]}  "{f["said"]}"')
    print(f'          → {f["cause"]}')
print()
print('Every line is a candidate `Stall` row for docs/human-input-log.md.')
print()
PY
