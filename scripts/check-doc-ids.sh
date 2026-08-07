#!/usr/bin/env bash
# check-doc-ids.sh — fail on duplicate BUG / TI / CHANGE ids in the tracking docs.
#
# Two jobs:
#  1. Catch the collision that next-doc-id.sh is meant to prevent, in case someone
#     hand-picked an id anyway.
#  2. Catch the ONE failure mode of the `merge=union` driver these docs now use
#     (.gitattributes). Union resolves append-vs-append automatically — which is the
#     common case and what kept re-conflicting — but if two branches EDIT THE SAME ROW
#     (e.g. both flip a status) it keeps both copies, leaving two rows with one id.
#     That is silent in a diff and obvious here.
#
# Runs in the pre-commit hook. Cheap: pure grep, no network.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

status=0

check() { # $1 = file, $2 = prefix
  local file=$1 prefix=$2 dupes
  [ -f "$file" ] || return 0
  dupes=$(grep -oE "^\| ${prefix}-[0-9]+ \|" "$file" | sort | uniq -d)
  if [ -n "$dupes" ]; then
    echo "ERROR: duplicate ids in $file:" >&2
    printf '%s\n' "$dupes" | sed 's/^/  /' >&2
    echo "  Two rows share an id. If this followed a merge, the union driver kept both" >&2
    echo "  sides of an edited row - keep one and fold in anything the other added." >&2
    status=1
  fi
}

check docs/phases/phase-bugs.md          BUG
check docs/technical-improvements.md     TI
check docs/phases/phase-minor-changes.md CHANGE

# The roadmap must not re-introduce a hand-maintained copy of bug status: that duplication
# is what made it both stale and a conflict magnet (three times on one PR). phase-bugs.md
# is the single source; the roadmap links to it.
if grep -qE '^\*\*Open now \([0-9]+\)' docs/roadmap.md 2>/dev/null; then
  echo "ERROR: docs/roadmap.md has re-grown an 'Open now (N)' bug list." >&2
  echo "  Bug status lives ONLY in docs/phases/phase-bugs.md - link to it, don't copy it." >&2
  status=1
fi

[ "$status" = 0 ] && echo "doc ids OK"
exit $status
