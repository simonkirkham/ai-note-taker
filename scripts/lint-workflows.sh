#!/usr/bin/env bash
# lint-workflows.sh — fail when a GitHub Actions workflow file is broken.
#
# Why this exists: a broken workflow does not fail like a test. TI-69's
# `timeout-minutes: ${{ fromJSON(inputs.runs) * 4 + 15 }}` was a PARSE error
# (Actions expressions have no arithmetic operators), so e2e.yml never loaded,
# `on:` was never read, `workflow_dispatch` never registered — and every push for
# three days produced a zero-job failing run named by file path. 162 false red X's,
# no annotation, no failing check, and the workflow silently did not exist.
# Nothing in the repo could have caught it. actionlint would have, on line 61.
#
# Coverage — read the second bullet before relying on this for composite actions:
#   - .github/workflows/*.yml|*.yaml — FULLY. Expression grammar, contexts available at
#     each key, unknown keys, plus shellcheck over every `run:` block.
#   - .github/actions/*/action.yml   — METADATA ONLY, and only INDIRECTLY. actionlint has
#     no action-file linter; an action.yml passed as a target yields `"on" section is
#     missing in workflow`, so it must never be linted that way. What it does do is parse
#     the metadata of every local action a workflow `uses:`. Measured, not assumed:
#       caught  — unparseable YAML   → `could not parse action metadata in ...`
#       caught  — bad `runs.using`   → `invalid runner name "..."`
#       MISSED  — anything inside the action's own `run:` block: an unused variable and an
#                 unquoted expansion both passed with exit 0
#     So a TI-69-shaped defect inside a COMPOSITE ACTION is NOT caught here. Closing that
#     needs a different tool; it is not what this script does.
#     Second gap: an action referenced by NO workflow is never looked at at all.
#
# On shellcheck — actionlint runs shellcheck over every `run:` block when shellcheck is
# on PATH. GitHub's ubuntu runners ship it, so CI always gets those rules; a local
# machine usually does not, and this script says so loudly rather than reporting a
# green that CI will not reproduce.
#
# Bumping actionlint: change VERSION and both checksums together (the checksums file
# is published alongside the release, e.g.
# https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_checksums.txt).
set -uo pipefail

VERSION=1.7.7
# Checksums of the release TARBALL and of the BINARY inside it, per arch. The binary hash
# is here so the gitignored .tools/ cache is re-verified on every run rather than trusted
# once at download; a cached file is the easiest thing in this scheme to tamper with.
TGZ_SHA_amd64=023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757
TGZ_SHA_arm64=401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0
BIN_SHA_amd64=9f7dedb4e23f89f2922073d1a6720405b7b520d4f5832ebb96f0d55a2958886c
BIN_SHA_arm64=446687e63fac45472b0a66bae28975c28678af062670af119c11a7087baf35cc

# For local runs: a machine that cannot FETCH the binary gets a loud skip
# instead of a blocked commit. NEVER set in CI. It does not rescue a lint finding, and it
# does not rescue a checksum mismatch — see below.
OPTIONAL=${LINT_WORKFLOWS_OPTIONAL:-0}

# Not `cd "$(git rev-parse ...)" || exit 1`: a failed substitution makes that `cd ""`, which
# bash treats as success and leaves the script running somewhere arbitrary.
root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ] || ! cd "$root"; then
  echo "workflow lint FAILED — could not resolve the repo root" >&2
  exit 1
fi

unavailable() { # $1 = reason — the tool could not be run at all (never a lint finding)
  if [ "$OPTIONAL" = "1" ]; then
    echo "  ⚠ workflow lint SKIPPED — $1"
    echo "    CI (docs-check.yml) still runs it; this commit is not covered locally."
    exit 0
  fi
  echo "workflow lint FAILED — $1" >&2
  exit 1
}

# A bad checksum is tampering or corruption, never a transient. It is fatal even in the
# hook, because "skip" here would mean shrugging at an unverified binary.
tampered() { # $1 = reason
  echo "workflow lint ABORTED — $1" >&2
  echo "  Refusing to run an unverified binary. Delete .tools/ and retry;" >&2
  echo "  if it recurs, the pinned checksums in this script are wrong or the release moved." >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || unavailable "only Linux builds are pinned here (found $(uname -s)); install actionlint $VERSION yourself and re-run, or set ACTIONLINT=/path/to/actionlint"

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64; tgz_sha=$TGZ_SHA_amd64; bin_sha=$BIN_SHA_amd64 ;;
  aarch64 | arm64) arch=arm64; tgz_sha=$TGZ_SHA_arm64; bin_sha=$BIN_SHA_arm64 ;;
  *) unavailable "no pinned actionlint build for $(uname -m)" ;;
esac

# Resolution order: explicit override, then PATH, then this repo's pinned cache.
# The first two are deliberate acts by whoever set them, so they are used as-is — but they
# bypass the pin, so say which binary is doing the work and warn on a version mismatch.
pinned=0
if [ -n "${ACTIONLINT:-}" ]; then
  bin=$ACTIONLINT
  [ -x "$bin" ] || unavailable "ACTIONLINT=$bin is not an executable file"
elif command -v actionlint >/dev/null 2>&1; then
  bin=$(command -v actionlint)
else
  pinned=1
  bin=".tools/actionlint-$VERSION"
  if [ ! -f "$bin" ]; then
    tgz="actionlint_${VERSION}_linux_${arch}.tar.gz"
    url="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${tgz}"
    tmp=$(mktemp -d) || unavailable "could not create a temp dir"
    trap 'rm -rf "$tmp"' EXIT
    echo "  ↓ fetching actionlint $VERSION ($arch)..."
    # Retried, because this download sits on the critical path of a check that now runs on
    # every push to main (TI-80), and one blip used to paint a red X on a commit that broke
    # nothing — the exact signal TI-69 taught this repo to stop reading. A guard against
    # false red X's must not have one of its own. (TI-84)
    #
    # --retry on its own only covers curl's "transient" set: timeouts and HTTP 408/429/5xx.
    # An outage arrives just as often as a reset connection, a TLS handshake failure or a
    # DNS miss, and none of those are in it. --retry-all-errors covers them, and is safe
    # here ONLY because the checksum two lines below is what decides whether the bytes are
    # trusted — no number of retries can turn a bad download into an accepted one. Its one
    # cost is that a genuinely absent release (a mistyped VERSION) now fails after 4 quick
    # attempts instead of 1, which is ~6s on a case that fails either way. It landed in
    # curl 7.71 (2020), and an older curl rejects the whole command line rather than the
    # single flag, so probe for it rather than assume it. Probed via a variable, not a
    # pipe: `curl ... | grep -q` can leave curl on SIGPIPE, and `pipefail` would then read
    # the successful match as a failure.
    #
    # Measured, not assumed: --max-time is applied PER ATTEMPT under --retry, not across
    # the set — a server stalling the first two of three requests under
    # `--max-time 3 --retry 2 --retry-delay 1` returned exit 0 after 8s of wall clock.
    #
    # --retry-delay does NOT bound the wait between attempts. curl sleeps for the LARGER
    # of --retry-delay and the server's Retry-After header, so a server asking for a long
    # pause gets it. That is not exotic here: GitHub rate-limits release-asset downloads
    # by IP and Actions runners share IP pools, so 429 + Retry-After is a primary path.
    # Measured against a local server (curl 8.5.0). The middle column is the BEFORE state —
    # the same cases without --retry-max-time, which is what motivated adding it; the right
    # column is each case re-measured with the exact flags this script now ships.
    #                              | before          | after (shipped flags)
    #   2 x 429, Retry-After: 20   | 40.0s,  exit 0  | 40.1s,  exit 0   a wait that fits is still served
    #   3 x 429, Retry-After: 120  | 360.3s, exit 0  | 120.1s, exit 22  bounded — a clean, attributable red
    #   2 x 429, no Retry-After    | 4.0s,   exit 0  | -                control: the header causes the wait
    # The 360s case is the one that matters. GitHub kills the job at 5 minutes with "has
    # exceeded the maximum execution time" — an annotation naming neither actionlint nor
    # the download, so the red X is both slower to appear AND harder to attribute than
    # the 6s "download failed" this replaced. That is the exact defect TI-84 exists to
    # remove, so a retry without a ceiling would have reintroduced it.
    #
    # Hence --retry-max-time 120. The rule is NOT "no retry starts once 120s have elapsed" —
    # under that rule a 429 arriving at t=0 with Retry-After: 310 would still be retried, and
    # curl would sleep the full 310s, well past the job kill. What curl actually requires is
    # that ELAPSED PLUS THE SLEEP IT IS ABOUT TO TAKE fits inside --retry-max-time, and a
    # Retry-After that does not fit is refused OUTRIGHT rather than shortened to the budget
    # that is left. Measured with the shipped flags: Retry-After: 310 -> ONE request, 0.011s,
    # exit 22. That is what makes 120 + 45 a true ceiling rather than arithmetic nobody
    # enforces: the last attempt can only BEGIN inside the 120s window, and is then bounded
    # by --max-time 45 — worst case measured at 164.1s (exit 28), a retry beginning at 119s
    # against a stalling server. Inside the job's timeout-minutes: 5, with ~2 min of headroom.
    #
    # The trade that buys: a rate limit asking for longer than 120s gets NO retry at all —
    # one request, then straight to red. That is the right side to fail on, because a fast
    # attributable red beats a job kill; but it does mean the retry does not help on the
    # long-rate-limit path this paragraph spends its length justifying. (The boundary is
    # inclusive: Retry-After: 120 exactly is still retried once, measured at 2 requests.)
    #
    # Raising --max-time or --retry-max-time means redoing that sum; 45s is already a
    # 45 KB/s floor on a 2 MB file, and failing an attempt fast is what lets the retry
    # help at all.
    #
    # --retry, --retry-delay and --retry-max-time are all curl 7.12.3 (2004) — old enough
    # to use unprobed. The two later ones are probed, same reason and same way:
    # --retry-all-errors is 7.71 (2020), --retry-connrefused 7.52 (2017).
    retry_flags=(--retry 3 --retry-delay 2 --retry-max-time 120)
    curl_help=$(curl --help all 2>/dev/null) || curl_help=""
    case "$curl_help" in *--retry-all-errors*) retry_flags+=(--retry-all-errors) ;; esac
    case "$curl_help" in *--retry-connrefused*) retry_flags+=(--retry-connrefused) ;; esac
    curl -sSfL --connect-timeout 10 --max-time 45 "${retry_flags[@]}" -o "$tmp/$tgz" "$url" \
      || unavailable "download failed, retries exhausted: $url"
    echo "$tgz_sha  $tmp/$tgz" | sha256sum -c - >/dev/null 2>&1 \
      || tampered "checksum mismatch on $tgz"
    tar -xzf "$tmp/$tgz" -C "$tmp" actionlint || unavailable "could not extract $tgz"
    if ! mkdir -p .tools || ! mv "$tmp/actionlint" "$bin"; then
      unavailable "could not install to $bin"
    fi
  fi
  # Re-verified every run, not just on the run that downloaded it.
  echo "$bin_sha  $bin" | sha256sum -c - >/dev/null 2>&1 \
    || tampered "cached $bin does not match the pinned binary checksum"
  chmod +x "$bin" 2>/dev/null || true
  [ -x "$bin" ] || unavailable "$bin is present but not executable"
fi

if ! command -v shellcheck >/dev/null 2>&1; then
  # In CI this is a hard failure, not a warning: actionlint drops the shellcheck rules
  # silently when the binary is absent, so the gate would quietly shrink to half its
  # coverage and still report green. Locally it is only a warning.
  if [ "${LINT_WORKFLOWS_REQUIRE_SHELLCHECK:-0}" = "1" ]; then
    unavailable "shellcheck is not on PATH — 'run:' blocks would go unlinted and the gate would silently shrink"
  fi
  echo "  ⚠ shellcheck not on PATH — 'run:' blocks are NOT linted here (CI's runner has it)"
fi

found_version=$("$bin" --version 2>/dev/null | head -1)
[ -n "$found_version" ] || unavailable "$bin would not report a version — it is not a working actionlint"
if [ "$pinned" = "0" ] && [ "$found_version" != "$VERSION" ]; then
  echo "  ⚠ using actionlint $found_version from $bin, NOT the pinned $VERSION — results may differ from CI"
else
  echo "  → actionlint $found_version via $bin"
fi

"$bin" -color
status=$?

# actionlint exits 1 for lint findings and 2/3 for its own failures (bad flags, unreadable
# config). Only 1 means "there are problems in the files above", so only 1 gets the epilogue
# that tells you to go fix them — anything else is the tool failing, which is a different
# conversation and must not be dressed up as a clean red.
case $status in
  0) ;;
  1)
    echo ""
    echo "✗ workflow lint failed. A workflow that does not parse is not a workflow:"
    echo "  GitHub silently drops its triggers and reports a zero-job red run on every"
    echo "  push. Fix the lines above — do not commit past this. (TI-69/TI-70)"
    ;;
  *) unavailable "actionlint itself failed (exit $status) — no workflow was checked" ;;
esac
exit $status
