# Picking up development on another machine

**Goal:** get a second machine to the point where you can start a slice on it — same credentials, same permissions, same working knowledge — without re-answering things you already answered here.

Two scripts do it. Run the first on the machine you have now, the second on the new one.

```bash
# on the OLD machine — package what git does not carry
bash scripts/export-machine-config.sh --with-secrets        # add --with-history for past sessions

# on the NEW machine — clone, install the toolchain, then apply the bundle
git clone https://github.com/simonkirkham/ai-note-taker.git /mnt/c/code/ai-note-taker
cd /mnt/c/code/ai-note-taker
bash scripts/setup-machine.sh                                    # installs .NET, Node, AWS CLI, CDK, gh, Docker, Chrome
bash scripts/check-machine.sh --apply --bundle ~/ai-note-taker-machine-config-<stamp>.tar.gz --deps
```

The second script prints a PASS/WARN/FAIL row per item and a one-line verdict. Exit 0 means ready to work.

## What lives where

| Thing | Where it is | Action on the new machine |
| --- | --- | --- |
| Code, docs, agent instructions, skills | Git | Comes with the clone |
| Project permission allow-list (`.claude/settings.local.json`) | Git — it is tracked | Comes with the clone |
| Plugins, marketplaces, auto-mode permissions, theme (`~/.claude/settings.json`) | This machine only | In the bundle |
| Folder-trust answer + tool allow-list (`~/.claude.json`) | This machine only | In the bundle |
| Memory files — how you want this project worked on | This machine only | In the bundle |
| Undrained human-input capture buffer | This machine only (gitignored) | In the bundle |
| Past session transcripts | This machine only | In the bundle with `--with-history` (155 MB today) |
| AWS keys for the three accounts | `~/.aws/credentials` | In the bundle with `--with-secrets` |
| GitHub login | `~/.config/gh` | Sign in again: `gh auth login` |
| .NET 10, Node 24, AWS CLI, CDK CLI, gh, python3, Docker | Installed software | Install; the check script names what is missing |
| Deployed secrets — Google client id/secret, refresh tokens, `ALLOWED_USER_SUBS`, Bedrock model id | GitHub Actions secrets + AWS SSM | **Nothing to do** — they live in the cloud, shared by every machine |

## Steps

1. **On the old machine, build the bundle.**
   ```bash
   bash scripts/export-machine-config.sh --with-secrets
   ```
   Writes one `.tar.gz` to your home directory, mode 600. With `--with-secrets` it contains live AWS keys — move it over an encrypted channel and delete it afterwards. Without the flag it carries no credentials, and you re-run `aws configure` on the other side instead.

2. **Install the toolchain on the new machine.** On Ubuntu or WSL, `bash scripts/setup-machine.sh` installs the lot — .NET 10, Node 24, AWS CLI v2, CDK, GitHub CLI, Docker, Chrome, jq, shellcheck — and is safe to re-run. On Windows or macOS, install those by hand.

3. **Clone to the same path: `/mnt/c/code/ai-note-taker`.** Several permission rules in `.claude/settings.json` are absolute paths. A different path means those rules stop matching and you get asked to approve things again.

4. **Apply the bundle.**
   ```bash
   bash scripts/check-machine.sh --apply --bundle <file> --deps
   ```
   `--deps` also runs `dotnet restore` and `npm --prefix web install`.

5. **Sign in to GitHub.** `gh auth login` — HTTPS, with scopes `repo`, `workflow`, `read:org`, `gist`.

6. **Re-run the check until it is clean.** `bash scripts/check-machine.sh`

## Things that catch people out

| Trap | Why it matters |
| --- | --- |
| A `region` line in `~/.aws/credentials` overrides `~/.aws/config` | The app is in `eu-west-2`. A profile defaulting elsewhere makes every command that omits `--region` come back empty, which reads as "the resource isn't there" rather than "you looked in the wrong place". The check script fails on this. |
| npm version, not just Node major | A lockfile cut on a different npm than CI's breaks `npm ci` in CI. Match CI's npm before regenerating `package-lock.json`. |
| `node_modules` is not portable between WSL and Windows | `web/` and `desktop/` carry OS-native binaries. Install on the side you run on; reinstall if you switch. |
| Every slice needs the worktree directory | `/mnt/c/code/ai-note-taker-slices`, a sibling of the checkout. The setup script creates it. |
| The desktop recorder is a separate install | On Windows: `npm --prefix desktop run update` pulls the latest published installer (needs `gh`). See [desktop/README.md](../desktop/README.md). |
| Playwright browsers are only needed for local E2E | Build `tests/Browser.E2E` then `pwsh tests/Browser.E2E/bin/Release/net10.0/playwright.ps1 install --with-deps chromium`. The browser journeys run in CI regardless. |

## Working on both machines at once

Sessions on different machines can see and message each other over Remote Control, which is already on (`remoteControlAtStartup` in the global settings the bundle carries). `ListAgents` lists them. Both machines push to the same `origin`, so the merge gates in [CLAUDE.md](../CLAUDE.md) apply across them — check `scripts/deploy-status.sh` before merging, wherever you are sitting.
