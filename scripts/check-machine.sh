#!/usr/bin/env bash
#
# Check that this machine can do the work — and, with --apply, install the config
# an existing machine exported (Claude permissions, folder trust, memory files,
# AWS credentials).
#
# Software installation is a separate script: scripts/setup-machine.sh. Run that
# first on a fresh box, this one second.
#
# Default mode checks everything and changes nothing.
#
# Usage:
#   bash scripts/check-machine.sh                                  # check only
#   bash scripts/check-machine.sh --apply --bundle ~/ai-note-taker-machine-config-*.tar.gz
#   bash scripts/check-machine.sh --apply --bundle <file> --deps   # also npm install + dotnet restore
#
# Exit 0 = ready to work. Exit 1 = something blocking is missing.
#
set -uo pipefail

MODE=check
BUNDLE=""
DO_DEPS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)  MODE=apply; shift ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --deps)   DO_DEPS=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL_PATH="/mnt/c/code/ai-note-taker"
WORKTREE_DIR="$(dirname "$REPO_ROOT")/ai-note-taker-slices"
MEMORY_KEY="$(printf '%s' "$REPO_ROOT" | tr '/' '-')"
MEMORY_DIR="$HOME/.claude/projects/$MEMORY_KEY/memory"
CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
EXPECT_PROD_ACCOUNT=642653037268
EXPECT_TEST_ACCOUNT=739754704263
EXPECT_REGION=eu-west-2

FAILS=0
WARNS=0

row() { # row <PASS|WARN|FAIL> <item> <detail>
  case "$1" in
    FAIL) FAILS=$((FAILS + 1)) ;;
    WARN) WARNS=$((WARNS + 1)) ;;
  esac
  printf '  %-4s  %-26s  %s\n' "$1" "$2" "$3"
}

# ============================================================== apply the bundle
if [ "$MODE" = apply ]; then
  echo "APPLYING SETUP"
  echo

  if [ -n "$BUNDLE" ]; then
    [ -f "$BUNDLE" ] || { echo "  bundle not found: $BUNDLE" >&2; exit 2; }
    STAGE="$(mktemp -d)"
    trap 'rm -rf "$STAGE"' EXIT
    tar -xzf "$BUNDLE" -C "$STAGE"
    SRC="$STAGE/bundle"

    mkdir -p "$HOME/.claude"

    # Global Claude settings: plugins, marketplaces, auto-mode allow list, theme.
    if [ -f "$SRC/claude/settings.json" ]; then
      if [ -f "$HOME/.claude/settings.json" ]; then
        cp "$HOME/.claude/settings.json" "$HOME/.claude/settings.json.bak-$(date +%s)"
        echo "  backed up the existing ~/.claude/settings.json"
      fi
      cp "$SRC/claude/settings.json" "$HOME/.claude/settings.json"
      echo "  installed ~/.claude/settings.json (plugins + auto-mode permissions)"
    fi
    [ -f "$SRC/claude/keybindings.json" ] && cp "$SRC/claude/keybindings.json" "$HOME/.claude/keybindings.json"

    # Memory files, under the key this machine's repo path produces.
    if [ -d "$SRC/claude/memory" ]; then
      mkdir -p "$MEMORY_DIR"
      cp -r "$SRC/claude/memory/." "$MEMORY_DIR/"
      echo "  installed $(find "$MEMORY_DIR" -name '*.md' | wc -l) memory files"
    fi

    # Trust answer + tool allow list, merged into this machine's ~/.claude.json.
    if [ -f "$SRC/claude/project-state.json" ]; then
      python3 - "$HOME/.claude.json" "$REPO_ROOT" "$SRC/claude/project-state.json" <<'PY'
import json, os, sys
target, repo, state_file = sys.argv[1], sys.argv[2], sys.argv[3]
state = json.load(open(state_file, encoding="utf-8"))
data = {}
if os.path.exists(target):
    data = json.load(open(target, encoding="utf-8"))
    os.replace(target, target + ".bak")
projects = data.setdefault("projects", {})
entry = projects.setdefault(repo, {})
entry.update(state)
json.dump(data, open(target, "w", encoding="utf-8"), indent=2)
print(f"  merged {len(state)} project keys into ~/.claude.json (trust + allowed tools)")
PY
    fi

    if [ -f "$SRC/claude/human-input-pending.jsonl" ] && [ ! -f "$REPO_ROOT/.claude/human-input-pending.jsonl" ]; then
      cp "$SRC/claude/human-input-pending.jsonl" "$REPO_ROOT/.claude/human-input-pending.jsonl"
      echo "  restored the undrained human-input capture buffer"
    fi

    if [ -d "$SRC/claude/transcripts" ]; then
      mkdir -p "$HOME/.claude/projects/$MEMORY_KEY"
      cp -r "$SRC/claude/transcripts/." "$HOME/.claude/projects/$MEMORY_KEY/"
      echo "  restored past session transcripts"
    fi

    # AWS credentials, only if the bundle carries them and this machine has none.
    if [ -d "$SRC/aws" ]; then
      mkdir -p "$HOME/.aws"
      for f in config credentials; do
        if [ -f "$SRC/aws/$f" ] && [ ! -f "$HOME/.aws/$f" ]; then
          cp "$SRC/aws/$f" "$HOME/.aws/$f"
          chmod 600 "$HOME/.aws/$f"
          echo "  installed ~/.aws/$f"
        elif [ -f "$SRC/aws/$f" ]; then
          echo "  left the existing ~/.aws/$f alone (bundle copy at $SRC/aws/$f)"
        fi
      done
    fi
  fi

  mkdir -p "$WORKTREE_DIR" && echo "  worktree directory ready: $WORKTREE_DIR"

  if [ "$DO_DEPS" -eq 1 ]; then
    echo "  restoring .NET packages..."
    dotnet restore "$REPO_ROOT/ai-note-taker.sln" >/dev/null 2>&1 \
      && echo "  dotnet restore OK" || echo "  dotnet restore FAILED — run it by hand to see why"
    echo "  installing frontend packages (this takes a few minutes)..."
    npm --prefix "$REPO_ROOT/web" install >/dev/null 2>&1 \
      && echo "  npm install OK" || echo "  npm install FAILED — run it by hand to see why"
  fi
  echo
fi

# ===================================================================== checks
echo "MACHINE CHECK — $REPO_ROOT"
echo

# --- repo location ------------------------------------------------------------
if [ "$REPO_ROOT" = "$CANONICAL_PATH" ]; then
  row PASS "repo path" "$REPO_ROOT"
else
  row WARN "repo path" "$REPO_ROOT is not $CANONICAL_PATH — path-based permission rules in .claude/settings.json will not match, so you will be asked to approve things again. Either clone to $CANONICAL_PATH or edit those rules."
fi

# --- toolchain ----------------------------------------------------------------
if command -v dotnet >/dev/null 2>&1 && dotnet --list-sdks 2>/dev/null | grep -q '^10\.'; then
  row PASS ".NET SDK" "$(dotnet --version)"
else
  row FAIL ".NET SDK" "need .NET 10 — https://dotnet.microsoft.com/download/dotnet/10"
fi

NODE_MAJOR="$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ "${NODE_MAJOR:-0}" -ge 24 ] 2>/dev/null; then
  row PASS "Node.js" "$(node --version) (CI runs 24)"
else
  row FAIL "Node.js" "need Node 24 to match CI — install via nvm or nodejs.org"
fi

if command -v npm >/dev/null 2>&1; then
  row PASS "npm" "$(npm --version) — must match CI's npm before you regenerate package-lock.json (see the CLAUDE.md guardrail)"
else
  row FAIL "npm" "missing"
fi

command -v cdk     >/dev/null 2>&1 && row PASS "AWS CDK CLI" "$(cdk --version)"      || row FAIL "AWS CDK CLI" "npm install -g aws-cdk"
command -v aws     >/dev/null 2>&1 && row PASS "AWS CLI" "$(aws --version 2>&1 | awk '{print $1}')" || row FAIL "AWS CLI" "https://aws.amazon.com/cli/"
command -v gh      >/dev/null 2>&1 && row PASS "GitHub CLI" "$(gh --version | head -1 | awk '{print $3}')" || row FAIL "GitHub CLI" "https://cli.github.com/"
command -v python3 >/dev/null 2>&1 && row PASS "python3" "$(python3 --version | awk '{print $2}')" || row FAIL "python3" "needed by several scripts/ helpers"

if command -v pwsh >/dev/null 2>&1; then
  row PASS "PowerShell (pwsh)" "$(pwsh --version 2>/dev/null | awk '{print $2}')"
else
  row WARN "PowerShell (pwsh)" "only needed to install Playwright browsers for tests/Browser.E2E — the browser journeys run in CI regardless"
fi

# --- GitHub auth --------------------------------------------------------------
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  SCOPES="$(gh auth status 2>&1 | grep -o "Token scopes:.*" | head -1)"
  MISSING=""
  for s in repo workflow read:org gist; do
    printf '%s' "$SCOPES" | grep -q "'$s'" || MISSING="$MISSING $s"
  done
  if [ -n "$MISSING" ]; then
    row WARN "GitHub login" "signed in, missing scopes:$MISSING — gh auth refresh -h github.com -s$(printf '%s' "$MISSING" | tr ' ' ',')"
  else
    row PASS "GitHub login" "$(gh api user --jq .login 2>/dev/null) with repo, workflow, read:org, gist"
  fi
else
  row FAIL "GitHub login" "gh auth login  (choose HTTPS; scopes repo, workflow, read:org, gist)"
fi

# --- AWS profiles -------------------------------------------------------------
check_profile() { # check_profile <name> <expected-account-or-empty>
  local name="$1" expected="${2:-}" acct region
  acct="$(aws sts get-caller-identity --profile "$name" --query Account --output text 2>/dev/null)"
  region="$(aws configure get region --profile "$name" 2>/dev/null)"
  if [ -z "$acct" ] || [ "$acct" = "None" ]; then
    row FAIL "AWS profile '$name'" "not usable — aws configure --profile $name  (region eu-west-2, output json)"
  elif [ -n "$expected" ] && [ "$acct" != "$expected" ]; then
    row FAIL "AWS profile '$name'" "points at account $acct, expected $expected"
  elif [ "$region" != "$EXPECT_REGION" ]; then
    row FAIL "AWS profile '$name'" "account $acct but default region is '${region:-unset}', not $EXPECT_REGION — every command that omits --region looks in the wrong region and comes back empty. Fix: set 'region = $EXPECT_REGION' under [$name] in ~/.aws/credentials (a region there overrides ~/.aws/config)."
  else
    row PASS "AWS profile '$name'" "account $acct, region $region"
  fi
}
if command -v aws >/dev/null 2>&1; then
  check_profile prod "$EXPECT_PROD_ACCOUNT"
  check_profile test "$EXPECT_TEST_ACCOUNT"
  check_profile management ""
fi

# --- Docker (DynamoDB Local + the local stack) --------------------------------
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  row PASS "Docker" "daemon reachable"
else
  row WARN "Docker" "needed for the EventStore integration tests and dev.sh — install Docker Desktop and turn on WSL integration for this distro"
fi

# --- Claude Code config -------------------------------------------------------
if [ -f "$HOME/.claude/settings.json" ] && grep -q enabledPlugins "$HOME/.claude/settings.json" 2>/dev/null; then
  row PASS "Claude global settings" "plugins + auto-mode permissions present"
else
  row WARN "Claude global settings" "$HOME/.claude/settings.json has no plugin/permission config — re-run with --apply --bundle <file> from the other machine, or you will be re-approving things"
fi

if [ -f "$REPO_ROOT/.claude/settings.local.json" ]; then
  row PASS "Project permissions" "tracked in git — came with the clone"
else
  row FAIL "Project permissions" ".claude/settings.local.json missing from the checkout"
fi

if [ -f "$HOME/.claude.json" ] && python3 -c "
import json,sys
d=json.load(open('$HOME/.claude.json',encoding='utf-8'))
sys.exit(0 if d.get('projects',{}).get('$REPO_ROOT',{}).get('hasTrustDialogAccepted') else 1)
" 2>/dev/null; then
  row PASS "Folder trust" "already answered for this path"
else
  row WARN "Folder trust" "Claude Code will ask once whether it trusts this folder"
fi

MEM_COUNT="$(find "$MEMORY_DIR" -name '*.md' 2>/dev/null | wc -l)"
if [ "$MEM_COUNT" -gt 0 ]; then
  row PASS "Memory files" "$MEM_COUNT under $MEMORY_DIR"
else
  row WARN "Memory files" "none — everything learned about how you want this project worked on stays on the old machine unless you apply a bundle"
fi

# --- odds and ends ------------------------------------------------------------
[ -d "$WORKTREE_DIR" ] && row PASS "Worktree directory" "$WORKTREE_DIR" \
  || row WARN "Worktree directory" "missing — mkdir -p $WORKTREE_DIR (every slice runs in one)"

[ -f "$CHROME" ] && row PASS "Chrome (for CSS checks)" "$CHROME" \
  || row WARN "Chrome (for CSS checks)" "not at the expected Windows path — visual/CSS measurement falls back to guesswork"

[ -d "$REPO_ROOT/web/node_modules" ] && row PASS "Frontend packages" "installed" \
  || row WARN "Frontend packages" "npm --prefix web install"

# ==================================================================== verdict
echo
if [ "$FAILS" -eq 0 ] && [ "$WARNS" -eq 0 ]; then
  echo "SETUP OK — ready to work"
  exit 0
elif [ "$FAILS" -eq 0 ]; then
  echo "SETUP OK — ready to work, $WARNS advisory item(s) above"
  exit 0
else
  echo "SETUP INCOMPLETE — $FAILS blocking, $WARNS advisory. Fix the FAIL rows above, then re-run."
  exit 1
fi
