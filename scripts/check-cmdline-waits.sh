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
# Reported by the session it happened to, on 2026-08-11, and again a day later — not measured
# here. The self-matching itself IS measured here, and is what the fixtures assert.
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
# subtracted out — it is one match per concurrent wrapper carrying the literal (a real count of
# 31 seen as 34 on a three-session box, reported by that session, not measured here). Never
# trust a count, only a pid.
#
# THE ESCAPE HATCH
# `# cmdline-wait-ok: <reason>` allows it. The reason is required — an exemption with no reason
# is refused — so an allowed case stays readable six months later. It reaches 3 lines in BOTH
# directions from the loop it applies to: just above it, or on the first lines inside it, and no
# further either way. Both bounds are there because both were breached — an unbounded reach
# downward let a marker exempt a loop 300 lines later, and an unbounded reach upward let a
# marker merely NAMED in prose deep in a loop body exempt that whole loop.
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
#  4. Two known false positives, both left as-is rather than coded around. A legitimate wait
#     that merely MENTIONS a process listing in an advice string reddens
#     (`until [ -f build.done ]; do echo "try 'ps -ef | grep dotnet'"; sleep 20; done`), and so
#     does a single-pass read over one snapshot when the scan lands on the `while` line
#     (`while IFS= read -r line; do …; done < <(ps -ef)`). Neither is the defect. Narrowing the
#     regex to exclude them would cost more sensitivity than the two cases are worth, and the
#     escape hatch covers both in one line.
#
# EDITING THIS FILE
# The awk program below is a single-quoted shell string, so ONE apostrophe anywhere inside it —
# in a comment, in the word "loop's" — terminates the quote and breaks the whole script. It
# fails loudly rather than silently: `bash -n` and the self-test both catch it immediately.
# Keep comments inside that block apostrophe-free.
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
    # pgrep/pkill asked for the FULL command line, with -f in ANY option position — not just
    # the first. `pgrep -c -f X` and `pgrep -u "$USER" -f X` are the same defect as `pgrep -fc
    # X`, and the first draft caught only the last of the three. `[^|;&]*` stops the search
    # reaching across a pipe into an unrelated command.
    if (s ~ /(^|[^A-Za-z0-9_-])(pgrep|pkill)[[:space:]]+[^|;&]*(-[A-Za-z]*f[A-Za-z]*|--full)([^A-Za-z0-9_-]|$)/) return 1
    # A full process listing, in two branches rather than one. A pid-scoped `ps -p <pid> -o …`
    # is not one, and neither is a `ps` with no listing flag at all.
    #  (a) the flag form: -e or -A, anywhere in the option list.
    if (s ~ /(^|[^A-Za-z0-9_-])ps[[:space:]]+[^|;&]*-[A-Za-z]*[eA]/) return 1
    #  (b) the BSD form: a bare `aux`/`ax` word. This MUST be a separate branch. Folded into
    #      (a) as an alternative it could never fire: `[[:space:]]+` consumes the only
    #      separating space and `[^|;&]*` cannot put one back, so it needed a SECOND space —
    #      `ps  aux` matched and `ps aux` did not. The branch was written, reviewed and never
    #      once executed, inside the guard built to refuse exactly that. It is now the shape
    #      two fixtures assert red.
    if (s ~ /(^|[^A-Za-z0-9_-])ps[[:space:]]+([^|;&]*[[:space:]])?(aux[A-Za-z]*|ax[A-Za-z]*)([^A-Za-z0-9_-]|$)/) return 1
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
        # Bounded in BOTH directions. open_loop applies the downward bound (a marker does not
        # reach a loop far below it); this is the upward one. Without it, `okd` was set on
        # every open loop at any distance, so a marker merely NAMED in prose 25 lines into a
        # loop body exempted that whole loop — the same defect red-marker-far-away.sh catches
        # from the other side, and the direction the prose in this very file sits in.
        for (i = 1; i <= depth; i++) if (NR - start[i] <= 3) okd[i] = 1
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
      if (pk == "while" || pk == "until" || code ~ /(^|[^A-Za-z0-9_])(while|until)([^A-Za-z0-9_]|$)/) {
        hdrscan = NR
      }
      # A for/select list is evaluated once, so it is not the wait of THIS loop — but it is
      # still attributable to any loop already open AROUND it. Marking only enclosing levels
      # (the header opens its own loop a token later, so that level is not open yet) is what
      # separates the two cases: a scan in a for-header inside a waiting while is the identical
      # defect with the scan moved from the for BODY to its header, while a bare
      # `for p in $(pgrep -f …)` at depth 0 marks nothing and stays green.
      #
      # The braces are load-bearing. Unbraced, `for (…) if (…) …` followed by `else` binds
      # that else to the INNER if, and awk silently swallows the body-scan branch below —
      # every scan in a loop body then went undetected while the file still parsed.
      else if (pk == "for" || pk == "select" || code ~ /(^|[^A-Za-z0-9_])(for|select)([^A-Za-z0-9_]|$)/) {
        for (j = 1; j <= depth; j++) if (scanln[j] == 0) scanln[j] = NR
      }
      # Otherwise it is in a body. Mark every enclosing level: the scan that drives an outer
      # wait is routinely written inside an inner loop.
      else {
        for (j = 1; j <= depth; j++) if (scanln[j] == 0) scanln[j] = NR
      }
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
