#!/usr/bin/env bash
# How many vitest SUITES are actually running on this box.
#
# Why not `ps | grep vitest`: this harness's wrapper shell carries the entire
# command text of whatever you just typed, so any grep for "vitest" matches the
# very command asking the question. Measured just now: 3 matching rows, ALL of
# them this session's own wrapper shells, 0 real suites. A raw match count is
# also not a suite count — one `vitest run` produces an npm row, an sh row and a
# node row, so a single suite reads as 3.
#
# This walks /proc positionally instead: argv[0] must be a node binary, and some
# later argv entry must be a path ending /.bin/vitest. A wrapper shell has
# argv[0] = /bin/bash and is structurally excluded, however much vitest text its
# command line carries. Suites are then deduped by worktree, since the leader and
# its workers share one.
set -u
for p in /proc/[0-9]*; do
  [ -r "$p/cmdline" ] || continue
  mapfile -d '' -t argv < "$p/cmdline" 2>/dev/null || continue
  [ "${#argv[@]}" -ge 2 ] || continue
  case "${argv[0]}" in
    node|*/node) ;;
    *) continue ;;
  esac
  for a in "${argv[@]:1}"; do
    case "$a" in
      */.bin/vitest) echo "${a%%/web/node_modules*}"; break ;;
    esac
  done
done | sort -u
