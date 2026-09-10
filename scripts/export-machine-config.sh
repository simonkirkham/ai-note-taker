#!/usr/bin/env bash
#
# Package the parts of this machine's setup that git does NOT carry, so a second
# machine can pick up development without re-approving everything from scratch.
#
# Writes a single .tar.gz. Nothing is written into the repo.
#
# Usage:
#   bash scripts/export-machine-config.sh                 # config only (safe to sync anywhere)
#   bash scripts/export-machine-config.sh --with-secrets  # ALSO includes ~/.aws credentials
#   bash scripts/export-machine-config.sh --with-history  # ALSO includes past session transcripts (large)
#   bash scripts/export-machine-config.sh --out ~/bundles # choose the output directory
#
set -euo pipefail

OUT_DIR="$HOME"
WITH_SECRETS=0
WITH_HISTORY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --with-secrets) WITH_SECRETS=1; shift ;;
    --with-history) WITH_HISTORY=1; shift ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MEMORY_KEY="$(printf '%s' "$REPO_ROOT" | tr '/' '-')"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
BUNDLE_NAME="ai-note-taker-machine-config-$(date +%Y%m%d-%H%M%S).tar.gz"
BUNDLE="$OUT_DIR/$BUNDLE_NAME"

mkdir -p "$STAGE/bundle/claude" "$OUT_DIR"

# ---------------------------------------------------------------- Claude Code
# Global settings: enabled plugins + their marketplaces, auto-mode allow list,
# theme, remote control. This is the file that stops the new machine asking
# about things this one already answered.
if [ -f "$HOME/.claude/settings.json" ]; then
  cp "$HOME/.claude/settings.json" "$STAGE/bundle/claude/settings.json"
fi
[ -f "$HOME/.claude/keybindings.json" ] && cp "$HOME/.claude/keybindings.json" "$STAGE/bundle/claude/keybindings.json"

# Per-project state from ~/.claude.json: the trust dialog answer and the tool
# allow list. The rest of that file is this machine's history and is left behind.
python3 - "$HOME/.claude.json" "$REPO_ROOT" "$STAGE/bundle/claude/project-state.json" <<'PY'
import json, sys, os
src, repo, dest = sys.argv[1], sys.argv[2], sys.argv[3]
keep = ("hasTrustDialogAccepted", "allowedTools", "mcpServers",
        "enabledMcpjsonServers", "disabledMcpjsonServers",
        "hasClaudeMdExternalIncludesApproved")
out = {}
if os.path.exists(src):
    with open(src, encoding="utf-8") as fh:
        proj = json.load(fh).get("projects", {}).get(repo, {})
    out = {k: proj[k] for k in keep if k in proj}
with open(dest, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
print(f"  project state: {len(out)} keys")
PY

# What Claude has learned about working on this repo. Machine-local; not in git.
if [ -d "$HOME/.claude/projects/$MEMORY_KEY/memory" ]; then
  mkdir -p "$STAGE/bundle/claude/memory"
  cp -r "$HOME/.claude/projects/$MEMORY_KEY/memory/." "$STAGE/bundle/claude/memory/"
fi

# The live capture buffer for "where did this stop for the human" — gitignored,
# drained into docs/human-input-log.md by Scribe, so an undrained one is unique
# to this machine.
if [ -f "$REPO_ROOT/.claude/human-input-pending.jsonl" ]; then
  cp "$REPO_ROOT/.claude/human-input-pending.jsonl" "$STAGE/bundle/claude/human-input-pending.jsonl"
fi

# Past session transcripts. Not needed to work, but scripts/sessions.sh and
# scripts/stall-scan.sh read them, and they are the only record of what was
# tried and rejected in earlier sessions. Large — opt in.
if [ "$WITH_HISTORY" -eq 1 ] && [ -d "$HOME/.claude/projects/$MEMORY_KEY" ]; then
  mkdir -p "$STAGE/bundle/claude/transcripts"
  find "$HOME/.claude/projects/$MEMORY_KEY" -maxdepth 1 -name '*.jsonl' \
    -exec cp {} "$STAGE/bundle/claude/transcripts/" \;
  echo "  transcripts: $(du -sh "$STAGE/bundle/claude/transcripts" | cut -f1)"
fi

# ------------------------------------------------------------------- versions
{
  echo "# Tool versions on the machine this bundle came from ($(hostname), $(date -u +%FT%TZ))."
  echo "# The new machine is checked against these by scripts/check-machine.sh."
  printf 'dotnet=%s\n' "$(dotnet --version 2>/dev/null || echo missing)"
  printf 'node=%s\n'   "$(node --version 2>/dev/null || echo missing)"
  printf 'npm=%s\n'    "$(npm --version 2>/dev/null || echo missing)"
  printf 'cdk=%s\n'    "$(cdk --version 2>/dev/null | awk '{print $1}' || echo missing)"
  printf 'gh=%s\n'     "$(gh --version 2>/dev/null | head -1 | awk '{print $3}' || echo missing)"
  printf 'aws=%s\n'    "$(aws --version 2>&1 | awk '{print $1}' || echo missing)"
  printf 'python3=%s\n' "$(python3 --version 2>/dev/null | awk '{print $2}' || echo missing)"
  printf 'repo_path=%s\n' "$REPO_ROOT"
} > "$STAGE/bundle/versions.txt"

# --------------------------------------------------------------------- AWS
if [ "$WITH_SECRETS" -eq 1 ]; then
  mkdir -p "$STAGE/bundle/aws"
  [ -f "$HOME/.aws/config" ]      && cp "$HOME/.aws/config"      "$STAGE/bundle/aws/config"
  [ -f "$HOME/.aws/credentials" ] && cp "$HOME/.aws/credentials" "$STAGE/bundle/aws/credentials"
  chmod -R go-rwx "$STAGE/bundle/aws"

  # Everything this project runs on lives in eu-west-2. A region line in the
  # credentials file overrides the one in config, so a wrong value there sends
  # every command that omits --region to an empty region — and an exported
  # bundle would carry that mistake to the next machine. Normalise the copy in
  # the bundle; the source machine's own files are untouched.
  APP_REGION=eu-west-2
  for f in "$STAGE/bundle/aws/credentials" "$STAGE/bundle/aws/config"; do
    [ -f "$f" ] || continue
    if grep -E "^[[:space:]]*region[[:space:]]*=" "$f" | grep -qvE "=[[:space:]]*$APP_REGION[[:space:]]*$"; then
      sed -i -E "s|^[[:space:]]*region[[:space:]]*=.*|region = $APP_REGION|" "$f"
      echo "  normalised the region in the bundled $(basename "$f") to $APP_REGION (this machine had a different one, which queries an empty region)"
    fi
  done
else
  # Profile names and accounts only — no keys. Enough to tell the new machine
  # what it is missing.
  {
    echo "# AWS profiles configured on the source machine (no credentials here)."
    grep -E '^\[' "$HOME/.aws/credentials" 2>/dev/null | tr -d '[]' || true
  } > "$STAGE/bundle/aws-profiles.txt"
fi

tar -czf "$BUNDLE" -C "$STAGE" bundle
chmod 600 "$BUNDLE"

echo
if [ "$WITH_SECRETS" -eq 1 ]; then
  echo "BUNDLE WRITTEN (CONTAINS AWS KEYS — move it over an encrypted channel, delete it after): $BUNDLE"
else
  echo "BUNDLE WRITTEN (no secrets): $BUNDLE"
fi
[ "$WITH_HISTORY" -eq 0 ] && echo "Session transcripts were NOT included — re-run with --with-history if you want scripts/sessions.sh and scripts/stall-scan.sh to see this machine's past sessions."
echo "Next: copy it to the other machine, then run"
echo "  bash scripts/check-machine.sh --apply --bundle <path-to-bundle>"
