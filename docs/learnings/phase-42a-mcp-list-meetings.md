# Phase 42-A — MCP `list_meetings` + calendar resolution off the route

**Slice:** 42-A · **PR:** #366 · **Deploy:** #670 · **Merged:** 2026-06-30

## What shipped

- `list_meetings(workspaceId, date, timezone?)` MCP tool — Claude lists a workspace's meetings for a date (title, time, recurring, linked-note id).
- `ICalendarScope` — identity/workspace a calendar resolution is for. Defaults to `(ICurrentUser, ICurrentWorkspace)` so every HTTP path is unchanged; the MCP tool overrides it with `(sub, workspaceIdArg)` before resolving. The four route-coupled consumers (Google/Microsoft token sources, ICS client, client factory) now read the scope, not the route directly.

## Learnings

### A picked-up PR can be open + MERGEABLE yet have NEVER run CI — "not failing" ≠ "passed"
- On resuming this slice, PR #366 was `OPEN` / `MERGEABLE` / `CLEAN` but `statusCheckRollup` was **empty** and `gh run list --branch <branch>` returned `[]`. CI had never triggered (the last commit was pushed without a workflow run, 19h earlier).
- A merge gate that checks "no check is failing" would read empty-as-green and merge **unverified** code. The fix: require checks to **exist and pass**, not merely "not fail." `scripts/merge-gate.sh` already gates on "all pass" over a non-empty list, but the trap is real for any hand-rolled `gh pr checks` read.
- **Resolution:** a fresh push re-triggered CI. When picking up any in-flight slice, confirm CI actually *ran* (non-empty check list) before trusting green — same failure shape as the CONFLICTING-branch near-empty-check-list trap already in CLAUDE.md.

### A stale slice branch shows phantom doc *deletions* in a two-dot diff
- `git diff main..HEAD` showed `phase-43.md` (−123), `roadmap.md`, `future-features.md` as deletions — alarming, but artifacts of a **stale local `main`** ref: those files were *added on main* after the branch's merge-base. The branch never touched them.
- Use the three-dot `git diff origin/main...HEAD` (merge-base..HEAD) for the branch's *real* change set, and `git fetch` first. Merging `origin/main` into the branch resolved it cleanly (doc-only, no conflict).

### A new read tool needs the same cross-workspace audit log as the write tools
- Hawk caught it: the write tools log `mcp_write_rejected` on a cross-workspace denial, but the read path threw silently — and "cross-workspace rejection logged for audit" was a **named Observability AC** for the slice (meeting titles are sensitive). Reads leak data too.
- **Fix:** added `mcp_read_rejected tool=… sub=… workspaceId=… reason=unauthorized` to the shared `AuthorizeAsync` helper, so all five read tools (`list_notes`/`get_note`/`search_notes`/`get_action_items`/`list_meetings`) get the audit line, not just the new one.

### Mutable per-request scope is safe only because the factory fails closed
- `CalendarScope.Set` is mutable scoped state. The `CalendarClientFactory` guards it: it throws if a resolve's `workspaceId != scope.WorkspaceId`. So a hypothetical concurrent second `Set` within one DI scope **errors** rather than serving cross-workspace data — the worst case is a spurious error, never a leak. When introducing mutable request-scoped state, pair it with a fail-closed consumer-side guard.

## Process / tooling
- `dotnet build`/`test` write `~/.dotnet`, `~/.aspnet`, `~/.templateengine` (first-run sentinels, telemetry) outside the worktree — not in the sandbox `allowWrite`, so they escaped the sandbox and prompted repeatedly. Added those paths + `DOTNET_CLI_TELEMETRY_OPTOUT`/`NOLOGO`/`SKIP_FIRST_TIME_EXPERIENCE`. See the sandbox-escape-hatch memory.
