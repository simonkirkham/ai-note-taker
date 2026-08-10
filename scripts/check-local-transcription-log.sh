#!/usr/bin/env bash
# Reads the desktop shell's on-device transcription log and gives a PASS/FAIL verdict for
# BUG-65 (is live transcription fast enough?) and BUG-67 (does the engine stop when the audio does?).
#
# Both bugs are closable ONLY from this log — the symptom of one is a number and of the other is
# CPU burn, so neither shows on screen. See desktop/MANUAL-VERIFICATION.md §BUG-65 / §BUG-67.
#
#   ./scripts/check-local-transcription-log.sh            # the most recent recording session
#   ./scripts/check-local-transcription-log.sh --all      # every session in the log
#   ./scripts/check-local-transcription-log.sh --path <f> # a log copied from another machine
#
# Exit 0 = both PASS. Exit 1 = at least one FAIL or INCONCLUSIVE.
set -uo pipefail

LOG=""
MODE="last"

while [ $# -gt 0 ]; do
  case "$1" in
    --all)   MODE="all"; shift ;;
    --path)  LOG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# The log lives beside the installed app's data, which from WSL is under the Windows user profile.
if [ -z "$LOG" ]; then
  for candidate in /mnt/c/Users/*/AppData/Roaming/ai-note-taker-desktop/local-transcription.log; do
    [ -f "$candidate" ] && LOG="$candidate" && break
  done
fi

if [ -z "$LOG" ] || [ ! -f "$LOG" ]; then
  cat >&2 <<'EOF'
NO LOG FOUND.

Expected it at:
  /mnt/c/Users/<you>/AppData/Roaming/ai-note-taker-desktop/local-transcription.log

That path only exists after the desktop app has run at least one local recording.
If you recorded on a different machine, copy the file over and pass --path <file>.
EOF
  exit 1
fi

awk -v mode="$MODE" -v logfile="$LOG" '
function pct(n, d) { return d > 0 ? sprintf("%.0f%%", 100 * n / d) : "n/a" }

function reset_session() {
  steps = 0; ok_steps = 0; slow = 0; failed = 0; dropped_total = 0; clamped_steps = 0
  frozen_run = 0; frozen_max = 0; prev_key = ""
  rtf_n = 0; rtf_max = 0
  delete rtf
}

function report(   i, j, tmp, median, v65, v67, bad) {
  if (started == 0) return
  printf "\n────────────────────────────────────────────────────────\n"
  printf "SESSION %d — started %s\n", session_no, start_ts
  if (start_cfg != "") printf "  %s\n", start_cfg

  if (steps == 0) {
    printf "\n  No step lines — the engine produced nothing this session.\n"
    printf "  BUG-65: INCONCLUSIVE   BUG-67: INCONCLUSIVE\n"
    fail_any = 1
    return
  }

  # median rtf — insertion sort, the arrays here are tens of entries not thousands
  for (i = 2; i <= rtf_n; i++) {
    tmp = rtf[i]
    for (j = i - 1; j >= 1 && rtf[j] > tmp; j--) rtf[j + 1] = rtf[j]
    rtf[j + 1] = tmp
  }
  median = rtf_n == 0 ? 0 : (rtf_n % 2 ? rtf[(rtf_n + 1) / 2] : (rtf[rtf_n / 2] + rtf[rtf_n / 2 + 1]) / 2)

  printf "\nBUG-65 — is live transcription fast enough?\n"
  printf "  steps            %d\n", steps
  printf "  rtf median       %.2f   max %.2f      (<1.00 = faster than realtime)\n", median, rtf_max
  printf "  rtf >= 1.00      %d of %d (%s)\n", slow, rtf_n, pct(slow, rtf_n)
  printf "  dropped          %d      (steps skipped because inference was still busy)\n", dropped_total
  printf "  clamped          %d of %d (%s)   (window hit the encoder send cap)\n", clamped_steps, steps, pct(clamped_steps, steps)
  printf "  failed steps     %d\n", failed

  if (steps < 10) {
    v65 = "INCONCLUSIVE — fewer than 10 steps; record continuously for ~30 s and re-run"
  } else if (failed > 0) {
    v65 = "FAIL — the engine errored; the err= lines are the diagnosis"
  } else if (slow * 10 > rtf_n) {
    v65 = "FAIL — inference is slower than realtime; threads are the next lever (see BUG-65 fix note 3)"
  } else if (clamped_steps * 5 > steps) {
    v65 = "FAIL — the send cap is engaging repeatedly, so it is falling behind"
  } else if (dropped_total * 10 > steps) {
    v65 = "FAIL — steps are being dropped by the busy-guard faster than the 1.5 s tick"
  } else {
    v65 = "PASS — inference keeps pace with the audio"
  }
  printf "  VERDICT: %s\n", v65

  printf "\nBUG-67 — does the engine stop when the audio does?\n"
  printf "  longest run of consecutive steps with window AND committed both frozen: %d\n", frozen_max
  printf "  (before the fix: ~12 such steps over ~30 s after pressing Stop)\n"
  # A "no spin seen" verdict drawn from too few steps cannot fail, and a check that cannot fail is
  # not evidence — the exact shape that made BUG-57 and BUG-65 pass on nothing.
  if (frozen_max >= 3) {
    v67 = "FAIL — the engine is re-transcribing stale audio; the idle guard is not firing"
  } else if (ok_steps < 5) {
    v67 = sprintf("INCONCLUSIVE — only %d successful step(s); too few for a frozen run to show at all", ok_steps)
  } else {
    v67 = "PASS — no spin on stale audio"
  }
  printf "  VERDICT: %s\n", v67

  if (v65 !~ /^PASS/ || v67 !~ /^PASS/) fail_any = 1
}

BEGIN { started = 0; session_no = 0; fail_any = 0; reset_session(); printf "LOG: %s\n", logfile }

/ session start /  {
  if (mode == "all") report()
  session_no++
  started = 1
  start_ts = $1
  sub(/^.* session start /, "")
  start_cfg = "session start " $0
  reset_session()
  next
}

/ step / {
  if (started == 0) next
  steps++

  if ($0 ~ / step FAILED /) {
    failed++
    prev_key = ""      # a failed step tells us nothing about audio advancing
    frozen_run = 0
    next
  }

  window = ""; committed = ""; rstr = ""; d = 0; c = 0
  for (i = 2; i <= NF; i++) {
    if ($i ~ /^window=/)    { window = substr($i, 8) }
    else if ($i ~ /^rtf=/)  { rstr = substr($i, 5) }
    else if ($i ~ /^committed=/) { committed = substr($i, 11) }
    else if ($i ~ /^dropped=/)   { d = substr($i, 9) + 0 }
    else if ($i ~ /^clamped=/)   { c = 1 }
  }

  # rtf is the literal "n/a" when the window was zero — that is not a fast step, it is no step.
  if (rstr != "" && rstr != "n/a") {
    r = rstr + 0
    rtf[++rtf_n] = r
    if (r > rtf_max) rtf_max = r
    if (r >= 1.0) slow++
  }
  ok_steps++
  dropped_total += d
  if (c) clamped_steps++

  # The BUG-67 symptom: window and committed BOTH unchanged means the same audio, re-transcribed.
  key = window "/" committed
  if (key == prev_key) { frozen_run++ } else { frozen_run = 1 }
  if (frozen_run > frozen_max) frozen_max = frozen_run
  prev_key = key
}

END {
  if (started == 0) {
    printf "\nNo \"session start\" line — the log exists but no local recording has run.\n"
    exit 1
  }
  report()
  printf "\nSessions in log: %d", session_no
  if (mode != "all" && session_no > 1) printf "  ·  only the most recent was analysed (--all for every one)"
  printf "\n"
  printf "\n────────────────────────────────────────────────────────\n"
  if (fail_any) {
    printf "NOT CLOSED — send this output; the numbers say which lever is next.\n"
    exit 1
  }
  printf "BOTH PASS — BUG-65 and BUG-67 can be marked Done.\n"
  exit 0
}
' "$LOG"
