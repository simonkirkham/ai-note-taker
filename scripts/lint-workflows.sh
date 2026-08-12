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
    # `--max-time 3 --retry 2 --retry-delay 1` returned exit 0 after 8s of wall clock. So
    # the worst case here is 4 x 45s + 3 x 2s = 186s, which fits inside the 5-minute
    # timeout-minutes on the job that runs this. Raising --max-time means redoing that sum;
    # 45s is already a 45 KB/s floor on a 2 MB file, and failing an attempt fast is what
    # lets the retry help at all.
    retry_flags=(--retry 3 --retry-delay 2 --retry-connrefused)
    curl_help=$(curl --help all 2>/dev/null) || curl_help=""
    case "$curl_help" in *--retry-all-errors*) retry_flags+=(--retry-all-errors) ;; esac
    curl -sSfL --connect-timeout 10 --max-time 45 "${retry_flags[@]}" -o "$tmp/$tgz" "$url" \
      || unavailable "download failed after 4 attempts: $url"
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
