#!/usr/bin/env bash
#
# Jump straight to the failed-step logs of a CI run, without hunting for the run id.
#
#   scripts/ci-logs.sh            # main's latest deploy run
#   scripts/ci-logs.sh <pr>       # the PR branch's latest run
#   scripts/ci-logs.sh <run-id>   # a specific run id (>= 7 digits)
#
# Prints the run's conclusion, then `gh run view <id> --log-failed`.
set -euo pipefail

arg="${1:-}"

if [[ -z "$arg" ]]; then
  id=$(gh run list --branch main --workflow deploy.yml --limit 1 -q '.[0].databaseId' --json databaseId)
  what="main deploy"
elif [[ "$arg" =~ ^[0-9]{7,}$ ]]; then
  id="$arg"
  what="run $id"
else
  branch=$(gh pr view "$arg" --json headRefName -q .headRefName)
  id=$(gh run list --branch "$branch" --limit 1 -q '.[0].databaseId' --json databaseId)
  what="PR #$arg ($branch)"
fi

if [[ -z "${id:-}" || "$id" == "null" ]]; then
  echo "No run found for $what"
  exit 1
fi

echo "=== $what — run $id ==="
gh run view "$id" --json status,conclusion -q '"status=\(.status) conclusion=\(.conclusion)"'
echo "--- failed steps ---"
gh run view "$id" --log-failed
