#!/usr/bin/env bash
#
# Self-test for check-cmdline-waits.sh (TI-79), driven by fixture files in a temp dir.
#
# Why this exists: pr.yml paths-ignores `scripts/**`, so a green PR proves nothing about a
# script — CI never runs one. The same gap that let TI-77 ship unexercised. And the thing
# under test is a GUARD, so the only evidence it works is watching it go red on a defect and
# stay green on the legitimate shapes next to it. A guard that reddens everything has only
# proved it noticed something.
#
# The fixtures are the review surface: each one is a shape someone might actually write, and
# the expectation next to it says whether this repo considers that shape safe.
#
#   bash scripts/test-check-cmdline-waits.sh
#
# Exit 0 = all cases pass. No network, no sleeps, well under a second.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$DIR/check-cmdline-waits.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

fixture() { cat >"$TMP/$1"; }

# run_case <name> <expected-exit> <fixture> <must-contain|-> <must-not-contain|->
run_case() {
  local name="$1" want="$2" f="$3" yes="$4" no="$5"
  local out rc bad=""
  out=$(bash "$CHECK" "$TMP/$f" 2>&1); rc=$?
  [[ "$rc" == "$want" ]] || bad="; exit $rc, wanted $want"
  [[ "$yes" != "-" ]] && ! grep -q -- "$yes" <<<"$out" && bad="$bad; missing '$yes'"
  [[ "$no" != "-" ]] && grep -q -- "$no" <<<"$out" && bad="$bad; must not say '$no'"
  if [[ -z "$bad" ]]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name — ${bad#; }"; sed 's/^/        /' <<<"$out"; fails=1
  fi
}

# ---------------------------------------------------------------------------
# The defect: a loop whose exit condition depends on scanning process cmdlines.
# ---------------------------------------------------------------------------

fixture red-oneline.sh <<'SH'
#!/usr/bin/env bash
echo starting
until ! pgrep -f "bin/eslint"; do sleep 15; done
echo done
SH
run_case "the 2026-08-11 loop, on one line" 1 red-oneline.sh "red-oneline.sh:3" -

fixture red-multiline.sh <<'SH'
#!/usr/bin/env bash
while pgrep -f "vitest run" >/dev/null
do
  sleep 10
done
SH
run_case "the same loop spread over three lines" 1 red-multiline.sh "red-multiline.sh:2" -

fixture red-count.sh <<'SH'
#!/usr/bin/env bash
while [ "$(pgrep -fc 'dotnet test')" -gt 0 ]; do
  sleep 10
done
SH
run_case "a count in the condition is the same defect" 1 red-count.sh "red-count.sh:2" -

# `-f` is not always the FIRST option. Both of these are red-count.sh and red-oneline.sh with a
# single space or one extra flag added, and both went green until the option regex stopped
# insisting `-f` came first — "narrow enough to be evaded by trivial rephrasing".
fixture red-pgrep-f-not-first.sh <<'SH'
#!/usr/bin/env bash
while [ "$(pgrep -c -f 'dotnet test')" -gt 0 ]; do
  sleep 10
done
SH
run_case "pgrep -c -f: -f in a later option position" 1 red-pgrep-f-not-first.sh "red-pgrep-f-not-first.sh:2" -

fixture red-pgrep-f-after-arg.sh <<'SH'
#!/usr/bin/env bash
until ! pgrep -u "$USER" -f "bin/eslint"; do
  sleep 15
done
SH
run_case "pgrep -u USER -f: -f after an option that takes a value" 1 red-pgrep-f-after-arg.sh "red-pgrep-f-after-arg.sh:2" -

fixture red-body-break.sh <<'SH'
#!/usr/bin/env bash
while true; do
  if ! pgrep -f "msbuild"; then break; fi
  sleep 5
done
SH
run_case "the exit condition hidden in the body" 1 red-body-break.sh "red-body-break.sh:3" -

fixture red-ps-grep.sh <<'SH'
#!/usr/bin/env bash
until [ -z "$(ps -ef | grep 'vitest' | grep -v grep)" ]; do
  sleep 20
done
SH
run_case "ps piped to grep is a cmdline scan too" 1 red-ps-grep.sh "red-ps-grep.sh:2" -

# The BSD `ps aux` form, and arguably the commonest way anyone writes this bug. All three went
# GREEN in the first draft: the aux/ax alternative sat behind a `[[:space:]]+` that had already
# eaten the only separating space, so it needed `ps  aux` with two spaces to fire. The branch was
# advertised in a comment, reviewed, and never once executed. These three are why it now is.
fixture red-ps-aux.sh <<'SH'
#!/usr/bin/env bash
while ps aux | grep -q "[v]itest run"; do
  sleep 10
done
SH
run_case "ps aux in the condition" 1 red-ps-aux.sh "red-ps-aux.sh:2" -

fixture red-ps-ax.sh <<'SH'
#!/usr/bin/env bash
until [ -z "$(ps ax | grep vitest | grep -v grep)" ]; do
  sleep 20
done
SH
run_case "ps ax in the condition" 1 red-ps-ax.sh "red-ps-ax.sh:2" -

fixture red-ps-aux-count.sh <<'SH'
#!/usr/bin/env bash
while [ "$(ps aux | grep -c dotnet)" -gt 1 ]; do
  sleep 15
done
SH
run_case "counting the lines of ps aux is the same defect" 1 red-ps-aux-count.sh "red-ps-aux-count.sh:2" -

# The shape a peer session walked into WHILE checking for this bug: no `pgrep -f` anywhere,
# the cmdlines read out of /proc instead. It self-matched exactly the same way.
fixture red-proc-cmdline.sh <<'SH'
#!/usr/bin/env bash
while true; do
  for p in $(pgrep -P "$SESSION"); do
    c=$(tr '\0' ' ' </proc/"$p"/cmdline)
    case "$c" in *"while true"*) alive=1 ;; esac
  done
  [ -z "$alive" ] && break
  sleep 30
done
SH
run_case "reading /proc cmdlines counts, with no pgrep -f in sight" 1 red-proc-cmdline.sh "red-proc-cmdline.sh:4" -

# The same defect as red-proc-cmdline.sh with the scan moved from the for BODY to the for HEADER.
# A for-list is evaluated once, so it is not the for loop's own wait — but a waiting loop is
# already open around it, and that is the one it belongs to. It went green while the for branch
# attributed the scan to nothing at all.
fixture red-for-header.sh <<'SH'
#!/usr/bin/env bash
while [ -n "$alive" ]; do
  alive=""
  for p in $(pgrep -f "vitest run"); do alive=1; done
  sleep 30
done
SH
run_case "a scan in a for-header inside a waiting loop" 1 red-for-header.sh "red-for-header.sh:4" -

# The [b]racket trick stops the scan matching the wrapper that TYPED it, but not a peer
# session's wrapper that happens to have typed the plain word. It is not a basis for a wait,
# so the shape is still refused.
fixture red-bracket.sh <<'SH'
#!/usr/bin/env bash
until [ "$(ps -eo args= | grep -cE '[v]itest')" = 0 ]; do
  sleep 20
done
SH
run_case "the bracket trick does not make the shape safe" 1 red-bracket.sh "red-bracket.sh:2" -

fixture red-marker-no-reason.sh <<'SH'
#!/usr/bin/env bash
# cmdline-wait-ok:
until ! pgrep -f "bin/eslint"; do sleep 15; done
SH
run_case "an exemption with no reason is refused" 1 red-marker-no-reason.sh "needs a reason" -

# Both of these were caught by pointing the checker at itself, and both were real: the marker
# was read before heredoc bodies were skipped, so a fixture exempted its own host file; and an
# exemption had unlimited reach, so this repo's own prose about the marker silently exempted
# the next loop in the same file.
fixture red-marker-in-heredoc.sh <<'SH'
#!/usr/bin/env bash
cat >"$T/doc.txt" <<'INNER'
# cmdline-wait-ok: this belongs to the nested program, not to the host
INNER
until ! pgrep -f "bin/eslint"; do sleep 15; done
SH
run_case "an exemption inside a heredoc does not exempt its host" 1 red-marker-in-heredoc.sh "red-marker-in-heredoc.sh:5" -

fixture red-marker-far-away.sh <<'SH'
#!/usr/bin/env bash
# cmdline-wait-ok: a reason attached to nothing in particular
echo one
echo two
echo three
echo four
echo five
until ! pgrep -f "bin/eslint"; do sleep 15; done
SH
run_case "an exemption does not reach a loop far below it" 1 red-marker-far-away.sh "red-marker-far-away.sh:8" -

# The same bound, in the other direction. The 3-line rule held downward from the start, but the
# marker was applied to every ALREADY-OPEN loop with no distance test at all — so a marker merely
# NAMED in prose deep inside a loop body exempted that whole loop. Which is the direction the
# prose in check-cmdline-waits.sh itself sits in.
fixture red-marker-inside-loop.sh <<'SH'
#!/usr/bin/env bash
while true; do
  sleep 5
  echo one
  echo two
  echo three
  echo four
  # The guard understands cmdline-wait-ok: a reason, described here in prose only.
  echo five
  pgrep -f "vitest run" || break
done
SH
run_case "an exemption named in prose deep in a body does not exempt the loop" 1 red-marker-inside-loop.sh "red-marker-inside-loop.sh:10" -

# ---------------------------------------------------------------------------
# Specificity: the legitimate neighbours must stay green, or the check gets turned off.
# ---------------------------------------------------------------------------

fixture ok-oneshot.sh <<'SH'
#!/usr/bin/env bash
# Hook-internal / bare-path use. Nothing wrapping this carries the pattern, so it is correct.
if pgrep -f "vitest run" >/dev/null; then
  echo "a suite is already running - commit anyway, this is only advice"
fi
SH
run_case "a one-shot scan is not a wait" 0 ok-oneshot.sh "OK" -

fixture ok-recovery.sh <<'SH'
#!/usr/bin/env bash
# The documented recovery command: find the stuck wrapper and report it. One shot, no loop.
ps -eo pid,ppid,etimes,args | grep -F "$1" | grep -vF 'grep -F'
SH
run_case "the recovery one-liner stays green" 0 ok-recovery.sh "OK" -

fixture ok-name-only.sh <<'SH'
#!/usr/bin/env bash
# pgrep with no -f matches the process NAME. The wrapper is named `bash`, so this cannot
# match the command text that invoked it - it is not a cmdline scan.
until ! pgrep chrome; do
  sleep 5
done
SH
run_case "name-only pgrep is not a cmdline scan" 0 ok-name-only.sh "OK" -

fixture ok-pid-scoped.sh <<'SH'
#!/usr/bin/env bash
# Scoped to one pid, so there is nothing to self-match against.
while ps -p "$pid" -o etimes= >/dev/null 2>&1; do
  sleep 5
done
SH
run_case "a pid-scoped ps is not a scan" 0 ok-pid-scoped.sh "OK" -

fixture ok-for-no-sleep.sh <<'SH'
#!/usr/bin/env bash
for p in $(pgrep -f "dotnet"); do
  echo "$p"
done
SH
run_case "a loop that iterates results and does not wait" 0 ok-for-no-sleep.sh "OK" -

fixture ok-comment.sh <<'SH'
#!/usr/bin/env bash
# Never write: until ! pgrep -f "bin/eslint"; do sleep 15; done
# It never exits, because the wrapper's own cmdline carries the pattern.
echo hello
SH
run_case "a comment warning about the defect is not the defect" 0 ok-comment.sh "OK" -

fixture ok-marker.sh <<'SH'
#!/usr/bin/env bash
# cmdline-wait-ok: run only by bare path from a git hook, never from a tool call, and the
# pattern is a fixed literal this script owns.
until ! pgrep -f "ai-note-taker-precommit"; do
  sleep 5
done
SH
run_case "a justified exemption is allowed" 0 ok-marker.sh "OK" -

# The other half of the bound above. Tightening the upward direction must not remove the natural
# place people put the marker - the first line inside the loop it applies to. Three lines either
# side of the loop start, and no further, in both directions.
fixture ok-marker-just-inside.sh <<'SH'
#!/usr/bin/env bash
until ! pgrep -f "ai-note-taker-precommit"; do
  # cmdline-wait-ok: run only by bare path, never from a tool call, fixed literal we own
  sleep 5
done
SH
run_case "an exemption on the first line inside the loop still allows it" 0 ok-marker-just-inside.sh "OK" -

fixture ok-substitutes.sh <<'SH'
#!/usr/bin/env bash
# The four safe waits. None of them reads a command line.
tail --pid="$pid" -f /dev/null
wait "$pid"
until grep -q BUILD_COMPLETE build.log; do sleep 20; done
until [ "$(git rev-parse HEAD)" != "$old_sha" ]; do sleep 20; done
SH
run_case "the safe substitutes are green" 0 ok-substitutes.sh "OK" -

# A heredoc is a nested program written out to disk and run by bare path. The scanner skips
# it, which is a STATED LIMIT rather than a claim of safety - and it is what keeps this test
# file itself green under the repo-wide scan below.
fixture ok-heredoc.sh <<'SH'
#!/usr/bin/env bash
cat >"$T/inner.sh" <<'INNER'
until ! pgrep -f "bin/eslint"; do sleep 15; done
INNER
SH
run_case "heredoc bodies are out of scope (stated limit)" 0 ok-heredoc.sh "OK" -

# ---------------------------------------------------------------------------
# The real tree. If this reddens, either the check is too broad or there is a
# second real instance - and the message has to say which file.
# ---------------------------------------------------------------------------
echo "the repository as it stands"
out=$(cd "$DIR/.." && bash "$CHECK" 2>&1); rc=$?
if [[ "$rc" == 0 ]]; then
  echo "PASS  every committed shell script is clean"
else
  echo "FAIL  the repo-wide scan is red"; sed 's/^/        /' <<<"$out"; fails=1
fi

echo
[[ "$fails" == 0 ]] && echo "check-cmdline-waits self-test: all cases pass"
exit "$fails"
