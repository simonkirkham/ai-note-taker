#!/usr/bin/env bash
# warm-projector.sh — warm the API and drain the Projector Lambda to the stream head.
#
# Why this exists as a separate step, not just "the suite retries": since RYW every
# projector-backed read is eventually consistent, and reload-tolerance can only re-gate a
# read that is GOING to converge — it cannot beat a cold projector that is seconds-to-minutes
# behind the head (the ActionReadYourWrites flake, deploy #566). So the gate warms AND drains
# before the journeys run.
#
# Best-effort by design: a warm-up hiccup must never fail the caller. Every failure path
# warns and returns 0.
#
# Env:
#   API_URL  (required) — API base url
#   TOKEN    (optional) — a Google id token; without it only /health warming happens
#
# NOTE: .github/workflows/deploy.yml still carries its own inline copy of this logic.
# Switching it over is TI-62 — deliberately not done in the same change that introduced
# this script, to keep the deploy path untouched.

set -uo pipefail

base="${API_URL%/}"

warmed=0
for i in $(seq 1 30); do
  start=$(date +%s%3N)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$base/health" || echo 000)
  ms=$(( $(date +%s%3N) - start ))
  echo "health ping $i: HTTP $code in ${ms}ms"
  if [ "$code" = "200" ] && [ "$ms" -lt 800 ]; then
    echo "API warm after $i ping(s)."
    warmed=1
    break
  fi
  sleep 1
done
[ "$warmed" = 1 ] || echo "::warning::/health did not reach <800ms in 30 pings — proceeding best-effort (E2E asserts have a 15s buffer)."

# Todos are workspace-scoped under /w/{workspaceId}; the reserved default workspace
# `__default__` is synthesised per user and always valid (WorkspaceId.DefaultValue), so a
# bare /todos 404s — use the scoped path, the same one the frontend's request() builds.
todos="$base/w/__default__/todos"

if [ -z "${TOKEN:-}" ]; then
  echo "::warning::no token — projector warm-up skipped (API still warmed via /health)."
  exit 0
fi

# One throwaway write gives us a consistency token; poll GET /todos with it until the gate
# stops returning `X-Consistency: stale`, i.e. the projector has applied everything up to
# that write (= the head at warm-up time). The caller clears test data afterwards, so the
# warm-up todo is wiped and the now-warm projector folds the clear's deletes fast.
resp=$(curl -s -w '\n%{http_code}' -X POST "$todos" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"warmup-e2e-rerun"}' --max-time 30) || resp=""
status=$(printf '%s' "$resp" | tail -n1)
tok=$(printf '%s' "$resp" | sed '$d' | jq -r '.consistencyToken // empty' 2>/dev/null) || tok=""
echo "warm-up POST $todos -> HTTP $status, token: ${tok:-<none>}"

if [ -z "$tok" ]; then
  echo "::warning::warm-up write returned no token (HTTP $status) — projector drain-wait skipped (API still warmed)."
  exit 0
fi

for i in $(seq 1 40); do
  if curl -s -D - -o /dev/null --max-time 30 \
       -H "Authorization: Bearer $TOKEN" -H "If-Consistent-With: $tok" \
       "$todos" | grep -qi '^X-Consistency:[[:space:]]*stale'; then
    echo "projector draining (stale) — poll $i"; sleep 1
  else
    echo "projector caught up to head after $i poll(s)."; break
  fi
done

exit 0
