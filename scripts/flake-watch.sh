#!/usr/bin/env bash
# flake-watch.sh — count CLEAN deploy-gate runs since a cutoff, per-attempt.
#
# Why per-attempt: a deploy re-run into green still CONTAINS the failure. Counting
# final conclusions is exactly how BUG-38 was recorded as 6 recurrences when the
# real number was 26. A run is clean only if EVERY attempt is free of the journey.
#
# Usage: flake-watch.sh <since-deploy-number> [journey-regex]
#   e.g. flake-watch.sh 720 'TagsJourney|ActionEditJourney'

set -uo pipefail
SINCE="${1:?usage: flake-watch.sh <since-deploy-number> [journey-regex]}"
PATTERN="${2:-TagsJourney}"

cd "$(git rev-parse --show-toplevel)" || exit 1

# The pattern is matched as "<JourneyClass>.<Method>", so a PARTIAL class name matches nothing
# and every run reports "clean" — a verdict indistinguishable from a genuinely clean history.
# That happened on 2026-09-21: `flake-watch.sh 770 RecordingTab` reported 15/15 clean while
# deploy #784 was red on RecordingTabJourney (the missing "Journey" is the whole bug). Compare
# the pattern against the journey classes that actually exist and refuse a name that matches none.
known=$(grep -rhoE 'class [A-Za-z0-9_]+' tests/Browser.E2E/Journeys 2>/dev/null | sed 's/^class //' | sort -u)
if [ -n "$known" ] && ! printf '%s\n' "$known" | grep -qE "^($PATTERN)$"; then
  printf 'REFUSED: no E2E journey class matches "%s".\n' "$PATTERN" >&2
  printf 'The filter is matched as <Class>.<Method>, so a partial class name would report every run clean.\n' >&2
  best=$(printf '%s\n' "$known" | grep -iE "$PATTERN" | head -3 | tr '\n' ' ')
  [ -n "$best" ] && printf 'Did you mean: %s\n' "$best" >&2
  exit 2
fi

clean=0; dirty=0
printf '%-8s %-12s %-9s %s\n' DEPLOY RUN ATTEMPTS VERDICT
printf '%s\n' "-------- ------------ --------- -------------------------------"

while read -r rid num; do
  [ "$num" -lt "$SINCE" ] && continue
  attempts=$(gh run view "$rid" --json attempt --jq '.attempt' 2>/dev/null || echo 1)
  hits=""
  for a in $(seq 1 "$attempts"); do
    found=$(gh run view "$rid" --attempt "$a" --log-failed 2>/dev/null \
            | grep -oE "$PATTERN\.[A-Za-z_]+" | sort -u | tr '\n' ' ')
    [ -n "$found" ] && hits="$hits[a$a: $found]"
  done
  if [ -z "$hits" ]; then
    clean=$((clean+1)); printf '%-8s %-12s %-9s %s\n' "#$num" "$rid" "$attempts" "clean"
  else
    dirty=$((dirty+1)); printf '%-8s %-12s %-9s %s\n' "#$num" "$rid" "$attempts" "HIT $hits"
  fi
done < <(gh run list --branch main --workflow deploy.yml --limit 40 \
         --json databaseId,number --jq '.[]|"\(.databaseId) \(.number)"')

echo
echo "clean=$clean  hit=$dirty  (target: 10 clean)"
[ "$clean" -ge 10 ] && echo "PROVEN — 10+ clean runs since #$SINCE" || echo "$((10-clean)) more clean runs needed"
