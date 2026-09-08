#!/usr/bin/env bash
# Installs the software a fresh Ubuntu/WSL machine needs to build, test and deploy
# this repo. Companion to scripts/setup-new-machine.sh, which checks what is present
# and carries across the settings git does not hold — run that one after this.
#
# One-shot setup for a fresh Ubuntu/WSL machine so this repo can be built, tested,
# linted, deployed and operated. Idempotent — safe to re-run.
#
# Installs: .NET 10 SDK, Node 24 (CI's major), AWS CLI v2, AWS CDK CLI, GitHub CLI,
# Docker Engine, Chrome (headless CSS measurement), jq, make, zip/unzip, shellcheck.
#
# Does NOT do the two things that need a human: `gh auth login` and AWS credentials.
# It prints exactly what is left at the end.
set -euo pipefail

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -eq 0 ]; then echo "Run as your normal user, not root (it uses sudo where needed)."; exit 1; fi

log "Refreshing package lists"
sudo apt-get update -qq

log "Base utilities (jq, make, zip/unzip, shellcheck, curl, ca-certificates)"
sudo apt-get install -y -qq jq make zip unzip shellcheck curl ca-certificates gnupg

if have dotnet && dotnet --list-sdks 2>/dev/null | grep -q '^10\.'; then
  log ".NET 10 SDK already installed — skipping"
else
  log "Installing .NET 10 SDK"
  sudo apt-get install -y -qq dotnet-sdk-10.0
fi

if have node && [ "$(node --version | cut -c2- | cut -d. -f1)" -ge 24 ]; then
  log "Node $(node --version) already installed — skipping"
else
  log "Installing Node 24 (matches CI's node-version: 24)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi

if have aws; then
  log "AWS CLI already installed ($(aws --version 2>&1)) — skipping"
else
  log "Installing AWS CLI v2"
  sudo apt-get install -y -qq awscli
fi

if have cdk; then
  log "AWS CDK CLI already installed ($(cdk --version)) — skipping"
else
  log "Installing AWS CDK CLI"
  sudo npm install -g aws-cdk
fi

if have gh; then
  log "GitHub CLI already installed ($(gh --version | head -1)) — skipping"
else
  log "Installing GitHub CLI (official apt repo, current version)"
  sudo mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq gh
fi

if have docker; then
  log "Docker already installed ($(docker --version)) — skipping"
else
  log "Installing Docker Engine (DynamoDB Local / Testcontainers)"
  sudo apt-get install -y -qq docker.io
  sudo usermod -aG docker "$USER"
  echo "NOTE: log out and back in (or run 'newgrp docker') before docker works without sudo."
fi
# WSL has no systemd by default — make sure the daemon is running now and on boot.
if have docker && ! docker info >/dev/null 2>&1; then
  sudo service docker start >/dev/null 2>&1 || true
fi

ARCH="$(dpkg --print-architecture)"
if have google-chrome || have google-chrome-stable; then
  log "Chrome already installed — skipping"
elif [ "$ARCH" != "amd64" ]; then
  log "Skipping Google Chrome — no Linux build exists for this machine's $ARCH processor"
  # A part-completed earlier run can leave an amd64-only source behind, which
  # makes every later apt-get update noisy on this machine.
  sudo rm -f /etc/apt/sources.list.d/google-chrome.list
  echo "  Headless page measurement uses Playwright's Chromium (installed below),"
  echo "  or Microsoft Edge on the Windows side."
else
  log "Installing Google Chrome (headless CSS/contrast measurement)"
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | sudo gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
    | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq google-chrome-stable
fi

log "Restoring project dependencies"
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dotnet restore "$REPO_ROOT/ai-note-taker.sln"
npm --prefix "$REPO_ROOT/web" install
[ -f "$REPO_ROOT/web/.env.local" ] || cp "$REPO_ROOT/web/.env.local.example" "$REPO_ROOT/web/.env.local"

log "Installing the Playwright browser used by the end-to-end tests"
# npx (Node) rather than playwright.ps1 (PowerShell): same download, same
# ~/.cache/ms-playwright location the .NET tests read, one less prerequisite.
npx --yes playwright install --with-deps chromium

log "Installed versions"
printf '  dotnet   %s\n' "$(dotnet --version 2>/dev/null || echo MISSING)"
printf '  node     %s\n' "$(node --version 2>/dev/null || echo MISSING)"
printf '  npm      %s\n' "$(npm --version 2>/dev/null || echo MISSING)"
printf '  aws      %s\n' "$(aws --version 2>&1 || echo MISSING)"
printf '  cdk      %s\n' "$(cdk --version 2>/dev/null || echo MISSING)"
printf '  gh       %s\n' "$(gh --version 2>/dev/null | head -1 || echo MISSING)"
printf '  docker   %s\n' "$(docker --version 2>/dev/null || echo MISSING)"
printf '  chromium %s\n' "$(ls -d "$HOME/.cache/ms-playwright"/chromium-* 2>/dev/null | head -1 || echo MISSING)"
printf '  jq       %s\n' "$(jq --version 2>/dev/null || echo MISSING)"

cat <<'REMAINING'

============================================================
STILL NEEDS YOU — two things this script cannot do
============================================================

1. Sign in to GitHub (needed by nearly every helper script):
     gh auth login --hostname github.com --git-protocol ssh --web

2. Add AWS credentials (needed only to inspect production or run the
   model evaluation; the normal build/deploy pipeline uses GitHub's own
   credentials, not yours):
     aws configure --profile prod
   then check it:
     aws sts get-caller-identity --profile prod

Then confirm everything works:
     dotnet test tests/Domain.Specs/Domain.Specs.csproj
============================================================
REMAINING
