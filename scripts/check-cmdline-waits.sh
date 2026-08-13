#!/usr/bin/env bash
# check-cmdline-waits.sh — refuse a committed wait loop whose exit depends on scanning
# process command lines. [TI-79]
#
# WHAT GOES WRONG WITHOUT IT
# A session goes quiet mid-task and stays quiet. Nobody is told it is stuck, it never reaches
# another tool round, and queued messages cannot reach it — a peer or the human asking "are
# you alive?" gets nothing back. Recovery is killing a process by hand.
#
# The mechanism: a wait built on scanning process command lines for a literal SELF-MATCHES.
# Each Bash tool call runs as `/bin/bash -c … && eval '<the entire command text>'`, so the
# wrapper's own cmdline carries whatever pattern was typed and the scan always finds itself.
# `pgrep -fc 'qqq-isolated-nonsense-qqq'` returns 1 on a completely idle box. So
# `until ! pgrep -f "bin/eslint"; do sleep 15; done` never exits, whatever eslint does.
# It happened for real on 2026-08-11.
#
# WHAT THIS FLAGS, AND WHAT IT DELIBERATELY DOES NOT
# It targets the SHAPE, not the tool: a loop that WAITS (the scan sits in its exit condition,
# or it scans and sleeps) and whose exit turns on reading other processes' command lines — by
# `pgrep -f`, by a full `ps` listing, or by reading /proc/<pid>/cmdline. A peer session walked
# into the identical bug with no `pgrep -f` in it at all, reading /proc instead, which is why
# banning one tool would not hold.
#
# It does NOT flag a one-shot scan. `pgrep -f` inside a committed script invoked by bare path
# is legitimate and correct — no wrapper then carries the pattern, and the same line that
# returns 1 from a tool call returns 0 there. It is the INVOCATION that is broken, not pgrep.
# Nor does it flag a name-only `pgrep` (the wrapper is named `bash`, so a name match cannot
# self-match), a pid-scoped `ps -p <pid>`, or a `for` loop iterating one snapshot of results.
#
# The [b]racket trick is NOT exempted. It stops the scan matching the wrapper that typed the
# pattern, but a peer session's wrapper that typed the plain word still matches, so the count
# is still not a fact about your job. And the inflation is not a constant that can be
# subtracted out — it is one match per concurrent wrapper carrying the literal (measured: a
# real count of 31 reported as 34 on a three-session box). Never trust a count, only a pid.
#
# THE ESCAPE HATCH
# `# cmdline-wait-ok: <reason>` on or just above the loop allows it. The reason is required —
# an exemption with no reason is refused — so an allowed case stays readable six months later.
#
# WHERE IT RUNS
# .github/workflows/docs-check.yml only. pr.yml paths-ignores scripts/**, and `.githooks/`
# was deleted from main on 2026-08-11, so there is no local hook and CI is the only place a
# check like this can live.
#
# KNOWN LIMITS, STATED RATHER THAN IMPLIED
#  1. It cannot cover an agent typing the loop straight into a Bash tool call — and that is
#     exactly where it happened. No check over committed files reaches that. The durable fix
#     for the ad-hoc case is the written rule in
#     docs/learnings/waiting-without-scanning-process-cmdlines.md.
#  2. Heredoc bodies are skipped. A heredoc is a nested program written to disk and run by
#     bare path, and its do/done tokens would corrupt the nesting count here.
#  3. It reads shell only — a wait written in Python or C# is not looked at.
#
#   bash scripts/check-cmdline-waits.sh              # every tracked shell script
#   bash scripts/check-cmdline-waits.sh path/to.sh   # named files
#
# Exit 0 = clean. Cheap: one awk pass per file, no network.
set -uo pipefail

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  root=$(git rev-parse --show-toplevel) || exit 1
  cd "$root" || exit 1
  # Tracked shell scripts, plus .githooks/* by name in case a hook is ever reinstated there
  # (those files carry no .sh extension). `git ls-files` means an untracked scratch file in
  # the tree is not the gate's business.
  mapfile -t files < <(git ls-files -- '*.sh' '.githooks/*' 2>/dev/null)
fi

[ "${#files[@]}" -eq 0 ] && { echo "no shell scripts to check"; exit 0; }

# One awk process per file, and END rather than gawk's ENDFILE: ubuntu-latest resolves `awk`
# to mawk, which does not have ENDFILE. A guard that only runs under one awk is not a guard.
scan_file() {
  awk -v FILE="$1" '
  function is_scan(s) {
    # pgrep/pkill asked for the FULL command line. -f, --full, and combined flags (-fc, -af).
    if (s ~ /(^|[^A-Za-z0-9_-])(pgrep|pkill)[[:space:]]+(-[A-Za-z]*f|--full)/) return 1
    # A full process listing: -e, -A, aux, ax. A pid-scoped `ps -p <pid> -o …` is not one.
    if (s ~ /(^|[^A-Za-z0-9_-])ps[[:space:]]+[^|;&]*(-[A-Za-z]*[eA]|[[:space:]]a?ux|[[:space:]]ax)/) return 1
    # Reading the command line straight out of /proc.
    if (s ~ /\/proc\/[^[:space:]]*\/cmdline/) return 1
    return 0
  }
  function open_loop() {
    depth++
    start[depth] = NR
    scanln[depth] = hdrscan; hdrscan_at[depth] = hdrscan
    # The exemption reaches the loop it sits on or just above — not a loop 300 lines later.
    # Without the distance bound, this file describing its own marker in prose exempted the
    # next loop in it.
    slept[depth] = 0; okd[depth] = (okpending && NR - okline <= 3)
    pk = ""; hdrscan = 0; okpending = 0
  }
  function close_loop(   d) {
    d = depth
    if (d < 1) return
    # A wait loop either tests the scan in its exit condition, or scans and sleeps. A loop
    # that iterates one snapshot of results and never waits is not the defect.
    if (!okd[d] && scanln[d] > 0 && (hdrscan_at[d] > 0 || slept[d])) {
      printf "ERROR: %s:%d: a loop waits on a scan of process command lines\n", FILE, scanln[d] > "/dev/stderr"
      printf "  the loop starts at line %d. On a tool call this scan matches the wrapper that\n", start[d] > "/dev/stderr"
      printf "  typed the pattern, so the condition never clears and the session goes silent.\n" > "/dev/stderr"
      status = 1
    } else if (d > 1 && scanln[d] > 0 && scanln[d-1] == 0) {
      # Not a wait itself, but the scan still belongs to whatever encloses it.
      scanln[d-1] = scanln[d]
    }
    delete scanln[d]; delete hdrscan_at[d]; delete slept[d]; delete okd[d]; delete start[d]
    depth--
  }
  BEGIN { depth = 0; pk = ""; hdrscan = 0; okpending = 0; okline = -99; heredoc = ""; status = 0 }
  {
    raw = $0

    # Heredoc bodies are skipped BEFORE anything else is read off the line, exemption marker
    # included: a heredoc is a nested program, and a marker written inside one belongs to that
    # program, not to this file. Reading it first let a fixture exempt its own host.
    if (heredoc != "") {
      line = raw; sub(/^[[:space:]]*/, "", line); sub(/[[:space:]]*$/, "", line)
      if (line == heredoc) heredoc = ""
      next
    }

    # An exemption must carry a reason. Read off the raw line so it works inside a comment.
    if (raw ~ /cmdline-wait-ok:/) {
      if (raw ~ /cmdline-wait-ok:[[:space:]]*[^[:space:]]/) {
        okpending = 1; okline = NR
        for (i = 1; i <= depth; i++) okd[i] = 1
      } else {
        printf "ERROR: %s:%d: a cmdline-wait-ok exemption needs a reason after the colon\n", FILE, NR > "/dev/stderr"
        status = 1
      }
    }

    code = raw
    if (code ~ /^[[:space:]]*#/) code = ""      # a whole-line comment is prose, not code

    if (is_scan(code)) {
      # A while/until condition is re-evaluated every iteration, so a scan there IS the wait.
      # The keyword may be on this line (read before the tokeniser below reaches it) or may
      # have opened a header on an earlier line.
      if (pk == "while" || pk == "until" || code ~ /(^|[^A-Za-z0-9_])(while|until)([^A-Za-z0-9_]|$)/)
        hdrscan = NR
      # A for/select list is evaluated once. Not a wait, and not attributable to an enclosing
      # loop either, since the scan belongs to the header being opened.
      else if (pk == "for" || pk == "select" || code ~ /(^|[^A-Za-z0-9_])(for|select)([^A-Za-z0-9_]|$)/)
        ;
      # Otherwise it is in a body. Mark every enclosing level: the scan that drives an outer
      # wait is routinely written inside an inner loop.
      else
        for (j = 1; j <= depth; j++) if (scanln[j] == 0) scanln[j] = NR
    }

    n = split(code, tok, /[^A-Za-z0-9_]+/)
    for (i = 1; i <= n; i++) {
      t = tok[i]
      # `hdrscan != NR` matters: on `until ! pgrep -f x; do`, the scan was recorded above
      # against this same line, and the keyword is only reached now. Clearing it here would
      # discard the very thing being looked for.
      if (t == "while" || t == "until" || t == "for" || t == "select") { pk = t; if (hdrscan != NR) hdrscan = 0 }
      else if (t == "do") { if (pk != "") open_loop() }
      else if (t == "done") close_loop()
      else if (t == "sleep") { for (j = 1; j <= depth; j++) slept[j] = 1 }
    }

    # `cat <<EOF`, `<<-EOF`, `<<"EOF"` — but not the `<<<` here-string.
    if (code ~ /<<-?[[:space:]]*[A-Za-z_"'"'"']/ && code !~ /<<</) {
      h = code; sub(/^.*<<-?[[:space:]]*/, "", h); sub(/[[:space:]].*$/, "", h)
      gsub(/["'"'"']/, "", h); sub(/[^A-Za-z0-9_].*$/, "", h)
      if (h != "") heredoc = h
    }
  }
  # An unterminated block is still judged, so a scan in one is not silently forgiven.
  END { while (depth > 0) close_loop(); exit status }
  ' "$1"
}

status=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  scan_file "$f" || status=1
done

if [ "$status" != 0 ]; then
  {
    echo
    echo "  Wait on something whose value actually changes, not on a process list:"
    echo "    wait <pid>                        # the job is a child of this shell"
    echo "    tail --pid=<pid> -f /dev/null     # it is not"
    echo "    until grep -q SENTINEL <file>; do sleep 20; done"
    echo "    until [ \"\$(git rev-parse HEAD)\" != \"<old-sha>\" ]; do sleep 20; done"
    echo "  A deliberate exception is allowed with '# cmdline-wait-ok: <reason>' on the loop."
    echo "  Background: docs/learnings/waiting-without-scanning-process-cmdlines.md"
  } >&2
  exit 1
fi

echo "cmdline-scan wait loops: none — OK (${#files[@]} script(s))"
