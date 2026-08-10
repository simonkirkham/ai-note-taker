#!/usr/bin/env bash
# Who is working on what, and how to get a session back after a crash.
#
#   scripts/sessions.sh          sessions active in the last 4 hours
#   scripts/sessions.sh 24       widen the window to 24 hours
#
# Read-only. Reads the local Claude Code transcripts plus `git worktree list`.
# No network, no cross-session messaging, nothing written.
set -euo pipefail

HOURS="${1:-4}"
REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"

# gh is optional — the table just loses its PR column without it
PRS="$(gh pr list --state open --json number,headRefName --limit 100 2>/dev/null || echo '[]')"

REPO="$REPO" HOURS="$HOURS" PRS="$PRS" \
  WORKTREES="$(git worktree list --porcelain)" python3 - <<'PY'
import json, os, glob, time, re

repo   = os.environ['REPO']
hours  = float(os.environ['HOURS'])
prs    = {p['headRefName']: p['number'] for p in json.loads(os.environ['PRS'])}
cutoff = time.time() - hours * 3600

# Claude stores transcripts under ~/.claude/projects/<cwd with / and . replaced by ->
slug = re.sub(r'[/.]', '-', repo)
tdir = os.path.expanduser(f'~/.claude/projects/{slug}')

# ---- worktrees -------------------------------------------------------------
worktrees = []
for block in os.environ['WORKTREES'].strip().split('\n\n'):
    path = branch = None
    for line in block.splitlines():
        if line.startswith('worktree '):
            path = line[9:]
        elif line.startswith('branch '):
            branch = line[7:].replace('refs/heads/', '')
    if path and branch and os.path.realpath(path) != os.path.realpath(repo):
        worktrees.append({'path': path, 'name': os.path.basename(path),
                          'branch': branch, 'sessions': []})

# ---- sessions --------------------------------------------------------------
sessions = []
for f in sorted(glob.glob(os.path.join(tdir, '*.jsonl')), key=os.path.getmtime, reverse=True):
    mtime = os.path.getmtime(f)
    if mtime < cutoff:
        continue
    sid = os.path.basename(f)[:-6]
    raw = open(f, errors='replace').read()
    custom = ai = None
    pr = None
    for line in raw.splitlines():
        if '"custom-title"' in line or '"ai-title"' in line or '"pr-link"' in line:
            try:
                r = json.loads(line)
            except Exception:
                continue
            t = r.get('type')
            if t == 'custom-title':
                custom = r.get('customTitle')
            elif t == 'ai-title':
                ai = r.get('aiTitle')
            elif t == 'pr-link':
                pr = r.get('prNumber')
    # A session working in a worktree hits its full path constantly. Merely
    # naming it once (a status report, a `git worktree list`) must not count —
    # so score by full-path frequency and keep only the clear top scorer.
    for w in worktrees:
        hits = raw.count(w['path'])
        if hits >= 20:
            w['sessions'].append((hits, sid[:8]))
    sessions.append({'id': sid, 'idle': (time.time() - mtime) / 60,
                     'title': custom or ai or '(no title yet)',
                     'named': custom is not None, 'pr': pr})

def ago(m):
    return f'{m:.0f}m' if m < 60 else f'{m/60:.1f}h'

print()
print(f'LIVE SESSIONS — active in the last {hours:g}h')
print('─' * 72)
if not sessions:
    print('  none')
for s in sessions:
    flag = '' if s['named'] else '   ⚠ unnamed'
    pr = f"PR #{s['pr']}" if s['pr'] else '—'
    print(f"  {ago(s['idle']):>6}  {s['title'][:48]:<48} {pr}{flag}")
    print(f"          claude --resume {s['id']}")
print()

unnamed = [s for s in sessions if not s['named']]
if unnamed:
    print(f"  ⚠ {len(unnamed)} session(s) unnamed — the title above is a guess.")
    print("    In each one: /rename <what it is working on>")
    print()

print('WORKTREES')
print('─' * 72)
if not worktrees:
    print('  none')
for w in worktrees:
    pr = f"PR #{prs[w['branch']]}" if w['branch'] in prs else 'no PR'
    owners = sorted(w['sessions'], reverse=True)[:1]
    w['owner'] = owners[0][1] if owners else None
    who = w['owner'] or '⚠ no live session'
    print(f"  {w['branch'][:44]:<44} {pr:<8} {who}")
print()

orphans = [w for w in worktrees if not w.get('owner')]
if orphans:
    print(f"  ⚠ {len(orphans)} worktree(s) with nothing working on them — crashed, or finished")
    print("    and never cleaned up. Check, then: git worktree remove <path>")
    print()
PY
