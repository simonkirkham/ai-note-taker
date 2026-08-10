#!/usr/bin/env bash
# next-doc-id.sh — allocate the next free BUG / TI / CHANGE id.
#
# Why this exists: two agent sessions each picked "highest id in my local file + 1" and
# collided four times in one day — BUG-58, TI-54, TI-58, and BUG-63 vs BUG-65 (two rows for
# one defect). A local view cannot see an id already claimed on someone else's unmerged
# branch, so the collision is only discovered at merge time, when renumbering also means
# chasing every cross-reference.
#
# So: scan main AND every remote branch, and take the max. An id claimed on an open PR is
# visible here the moment it is pushed.
#
# A fixed bug is moved OUT of phase-bugs.md into phase-bugs-archive.md, so the archive must be
# scanned too — otherwise the highest live id falls every time a bug is closed and the next
# allocation reuses a retired number. Rows are matched as "| BUG-N" and archive entries as
# "## BUG-N".
#
# Usage: next-doc-id.sh <bug|ti|change>
set -uo pipefail

kind="${1:-}"
case "$kind" in
  bug)    files=(docs/phases/phase-bugs.md docs/phases/phase-bugs-archive.md); prefix=BUG ;;
  ti)     files=(docs/technical-improvements.md);                              prefix=TI ;;
  change) files=(docs/phases/phase-minor-changes.md);                          prefix=CHANGE ;;
  *) echo "usage: $0 <bug|ti|change>" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)" || exit 1

# Quietly refresh so a branch pushed seconds ago is included.
git fetch --quiet --prune origin 2>/dev/null

max=0
seen_in=""
# A row is "| BUG-12 | ...", an archive entry is "## BUG-12 — ...". Match both.
id_re="^(\| |## )${prefix}-[0-9]+"

scan() { # $1 = git revision, $2 = label
  local content n f
  for f in "${files[@]}"; do
    content=$(git show "$1:$f" 2>/dev/null) || continue
    n=$(printf '%s\n' "$content" | grep -oE "$id_re" | grep -oE '[0-9]+' | sort -n | tail -1)
    [ -z "$n" ] && continue
    if [ "$n" -gt "$max" ]; then max=$n; seen_in=$2; fi
  done
}

scan origin/main "origin/main"
while read -r ref; do
  [ -z "$ref" ] && continue
  scan "$ref" "${ref#origin/}"
done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v '^origin/HEAD$' | grep -v '^origin/main$')

# An uncommitted local edit counts too - you may have just written a row without committing.
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  n=$(grep -oE "$id_re" "$f" 2>/dev/null | grep -oE '[0-9]+' | sort -n | tail -1)
  if [ -n "$n" ] && [ "$n" -gt "$max" ]; then max=$n; seen_in="working tree"; fi
done

next=$((max + 1))
echo "${prefix}-${next}"
echo "  highest existing: ${prefix}-${max} (in ${seen_in:-none})" >&2
echo "  scanned origin/main + $(git for-each-ref refs/remotes/origin | wc -l) remote refs + working tree" >&2
