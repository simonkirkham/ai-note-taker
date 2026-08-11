#!/usr/bin/env bash
# TI-61 contention harness.
#   MODE=quiet  -> no spinners, no marker (baseline / isolation runs)
#   MODE=load   -> N spinners + marker held ONLY for the duration of the run
# The marker is removed by a trap on EXIT/INT/TERM/HUP so a crash cannot leave
# the other session parked on a window that already ended.
#
# Copies of Routing.test.tsx are regenerated from the CURRENT file on every run.
# Testing stale copies is how an injected-defect step silently proves nothing.
set -u
MODE=${MODE:-load}
COPIES=${COPIES:-10}
SPINNERS_N=${SPINNERS_N:-16}
MARKER=/tmp/claude-1000/-mnt-c-code-ai-note-taker/a5205d85-7bcd-4064-8eca-cd79fb0a3f40/scratchpad/LOAD-BURST-ACTIVE
ROOT=/mnt/c/code/ai-note-taker-slices/ti-61-routing-flake
T=$ROOT/web/src/__tests__
SPINNERS=()

cleanup() {
  for p in "${SPINNERS[@]:-}"; do kill "$p" 2>/dev/null; done
  [ "$MODE" = load ] && rm -f "$MARKER"
  echo "RUN-ENDED $(date +%T)"
}
trap cleanup EXIT INT TERM HUP

# Load average is corroboration, never the primary signal: load1 lags ~90s, and a
# box with three live suites has been measured at ratio 0.28. Count processes first.
loadline() {
  read -r l1 l5 _ < /proc/loadavg
  local suites procs d
  # boxcount.sh, not a ps|grep: a grep for "vitest" matches this harness's own
  # wrapper shell, and one suite yields several rows. See boxcount.sh header.
  suites=$("$ROOT/boxcount.sh" | wc -l)
  procs=$(ps -eo args= | grep -c '[v]itest')
  d=$(ps -eo args= | grep -cE '[d]otnet test|[d]otnet build|[M]SBuild')
  awk -v c="$(nproc)" -v a="$l1" -v b="$l5" -v s="$suites" -v v="$procs" -v d="$d" -v tag="$1" \
    'BEGIN{printf "%s vitest_suites=%d vitest_procs=%d dotnet_procs=%d load1=%.2f ratio1=%.2f load5=%.2f ratio5=%.2f\n", tag, s, v, d, a, a/c, b, b/c}'
}

rm -f "$T"/_ti61load*.test.tsx "$T"/_ti61fix*.test.tsx
for i in $(seq 1 "$COPIES"); do
  sed "s/Routing (21-A)/Routing ASIS$i/" "${ASIS_SRC:-$T/Routing.test.tsx}" > "$T/_ti61load$i.test.tsx"
done
echo "ASIS-COPIES-FROM $(cd $ROOT && git hash-object ${ASIS_SRC:-web/src/__tests__/Routing.test.tsx})"
# Second arm, same run, same contention: a within-run control beats comparing windows.
if [ "${FIX_ARM:-0}" = 1 ]; then
  for i in $(seq 1 "$COPIES"); do
    sed "s/Routing (21-A)/Routing FIXED$i/" "$ROOT/Routing.fixed.tsx" > "$T/_ti61fix$i.test.tsx"
  done
  echo "FIX-COPIES-FROM $(cd $ROOT && git hash-object Routing.fixed.tsx)"
fi

echo "RUN-STARTED $(date +%T) mode=$MODE copies=$COPIES spinners=$([ "$MODE" = load ] && echo "$SPINNERS_N" || echo 0)"
loadline PRE

if [ "$MODE" = load ]; then
  mkdir -p "$(dirname "$MARKER")"
  # Content, not mere existence: an orphaned marker left by a crashed run is
  # otherwise indistinguishable from a live one, and a reader blocks forever on a
  # window that already ended. UTC stamp INSIDE the file so "is this stale?" is a
  # reading, not a judgement — mtime against local wall-clock is the trap.
  cat > "$MARKER" <<EOF
owner=TI-61 agent (session TIs)
set_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
eta_minutes=${ETA_MINUTES:-15}
what=${BURST_WHAT:-TI-61 contention run}
pid=$$
EOF
  for _ in $(seq 1 "$SPINNERS_N"); do ( while :; do :; done ) & SPINNERS+=("$!"); done
  sleep 100
  loadline SETTLED
fi

cd "$ROOT"
FILES=()
for i in $(seq 1 "$COPIES"); do
  FILES+=("src/__tests__/_ti61load$i.test.tsx")
  [ "${FIX_ARM:-0}" = 1 ] && FILES+=("src/__tests__/_ti61fix$i.test.tsx")
done
[ "${WITH_PROBE:-1}" = 1 ] && FILES+=("src/__tests__/_ti61probe.test.tsx")

timeout "${RUN_TIMEOUT:-2400}" npx --prefix web vitest run --root web "${FILES[@]}" --reporter=verbose 2>&1
echo "VITEST_EXIT=$?"
loadline POST
