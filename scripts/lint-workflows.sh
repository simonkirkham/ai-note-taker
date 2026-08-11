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
# Coverage:
#   - .github/workflows/*.yml|*.yaml — directly (actionlint's default glob).
#   - .github/actions/*/action.yml   — INDIRECTLY, via each workflow's `uses:`.
#     actionlint has no action-file linter and rejects an action.yml passed as a
#     target ("on" section is missing), but it DOES parse and validate every local
#     action a workflow references. Verified: an unparseable action.yml reports
#     `could not parse action metadata in ...` against the `uses:` line.
#     Gap: an action referenced by NO workflow is never checked.
#
# shellcheck: actionlint runs shellcheck over every `run:` block when shellcheck is
# on PATH. GitHub's ubuntu runners ship it, so CI always gets those rules; a local
# machine usually does not, and this script says so loudly rather than reporting a
# green that CI will not reproduce.
#
# Bumping actionlint: change VERSION and both checksums together (the checksums file
# is published alongside the release, e.g.
# https://github.com/rhysd/actionlint/releases/download/v1.7.7/actionlint_1.7.7_checksums.txt).
set -uo pipefail

VERSION=1.7.7
SHA_amd64=023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757
SHA_arm64=401942f9c24ed71e4fe71b76c7d638f66d8633575c4016efd2977ce7c28317d0

# Set by .githooks/pre-commit: a local machine that cannot fetch the binary gets a
# loud skip instead of a blocked commit. NEVER set in CI — CI is the real gate.
OPTIONAL=${LINT_WORKFLOWS_OPTIONAL:-0}

cd "$(git rev-parse --show-toplevel)" || exit 1

unavailable() { # $1 = reason
  if [ "$OPTIONAL" = "1" ]; then
    echo "  ⚠ workflow lint SKIPPED — $1"
    echo "    CI (docs-check.yml) still runs it; this commit is not covered locally."
    exit 0
  fi
  echo "workflow lint FAILED — $1" >&2
  exit 1
}

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64; sha=$SHA_amd64 ;;
  aarch64 | arm64) arch=arm64; sha=$SHA_arm64 ;;
  *) unavailable "no pinned actionlint build for $(uname -m)" ;;
esac

# Resolution order: explicit override, then PATH, then this repo's pinned cache.
if [ -n "${ACTIONLINT:-}" ]; then
  bin=$ACTIONLINT
elif command -v actionlint >/dev/null 2>&1; then
  bin=$(command -v actionlint)
else
  bin=".tools/actionlint-$VERSION"
  if [ ! -x "$bin" ]; then
    tgz="actionlint_${VERSION}_linux_${arch}.tar.gz"
    url="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${tgz}"
    tmp=$(mktemp -d) || unavailable "could not create a temp dir"
    trap 'rm -rf "$tmp"' EXIT
    echo "  ↓ fetching actionlint $VERSION ($arch)..."
    curl -sSfL --max-time 120 -o "$tmp/$tgz" "$url" || unavailable "download failed: $url"
    echo "$sha  $tmp/$tgz" | sha256sum -c - >/dev/null 2>&1 \
      || unavailable "checksum mismatch on $tgz — refusing to run an unverified binary"
    tar -xzf "$tmp/$tgz" -C "$tmp" actionlint || unavailable "could not extract $tgz"
    mkdir -p .tools && mv "$tmp/actionlint" "$bin" && chmod +x "$bin" \
      || unavailable "could not install to $bin"
  fi
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

echo "  → $("$bin" --version | head -1) via $bin"
"$bin" -color
status=$?

if [ $status -ne 0 ]; then
  echo ""
  echo "✗ workflow lint failed. A workflow that does not parse is not a workflow:"
  echo "  GitHub silently drops its triggers and reports a zero-job red run on every"
  echo "  push. Fix the lines above — do not commit past this. (TI-69/TI-70)"
fi
exit $status
