# Phase 42-B — calendar-linked note creation over MCP _(completes Phase 42)_

**Slice:** 42-B · **PR:** #369 · **Deploy:** #677 · **Merged:** 2026-06-30

## What shipped

- `create_note_from_meeting(workspaceId, calendarEventId, title, startTime, endTime, isRecurring?, recurringSeriesId?)` — Claude creates a dated note linked to a specific meeting.
- `create_note_from_next_occurrence(workspaceId, recurringSeriesId)` — same, for the next future occurrence of a recurring series.
- Both mirror the HTTP `CalendarHandlers` but resolve identity from `(sub, workspaceId)` via 42-A's `ICalendarScope`. No event-model change. Tool count now 13 (the cap).
- Refactor: `create_note` (41-A) now shares the extracted `AuthorizeWriteAsync`.

## Learnings

### GitHub silently drops the PR `synchronize` event — a push can leave the new commit with NO CI run
- After pushing the Hawk-suggestion commit (`ae92434`), the **PR Checks** workflow never started — `gh run list` showed a run only for the *previous* commit. The push's `pull_request.synchronize` event was dropped (same failure that left PR #366 with zero runs at the start of this session).
- The merge gate then read the *previous* commit's passing checks and reported "PR CI: ok (all pass)" — a **stale green**. Merging there would ship code whose own commit never ran CI.
- **Re-trigger cleanly with close→reopen** (`gh pr close <n> && gh pr reopen <n>`): the `reopened` event re-evaluates the full PR diff against `paths-ignore`, so a code change re-runs backend/eventstore/frontend without a junk commit. The run was queued within seconds.
- **Generalise:** before trusting a green merge gate, confirm the checks belong to the **current head sha**, not just that "nothing is failing." `gh pr view <n> --json headRefOid` vs the run's `headSha`.

### A "no pending + non-empty" CI-settle loop exits early on a near-empty check list
- The first settle-loop waited for "no check is `pending` AND ≥1 check exists." Right after a push, only the head-only `CodeRabbit` check had registered (the backend/eventstore/frontend checks for the new commit hadn't appeared yet) → the loop saw 1 non-pending check and exited "settled" prematurely.
- **Fix:** gate the wait on the **named** checks being present *and* non-pending — `map(.name) | (index("backend") and index("eventstore") and index("frontend"))` — not a bare count. Mirrors the CLAUDE.md CONFLICTING-branch near-empty-checklist trap; the same defence applies to a freshly-pushed commit whose checks haven't all registered.

### Don't stack a parallel re-run on a red shared main deploy
- The merge was blocked by main deploy #676 (bug-38) failing at the E2E gate. A parallel session was already re-running it. Per the guardrail, I waited for the in-flight re-run rather than firing my own — concurrent deploy re-runs jam the CloudFormation stack-lock and look like a hang. #676's re-run went green (a flake); the gate cleared.

## Design notes (carried for 42-B reviewers / future calendar-MCP work)
- Duplicate handling **diverges from HTTP's 409**: an existing link for the caller returns the existing note with `alreadyExists: true` (the noteId rides the same payload, so a reload is actionable) — better Claude UX, consistent with 42-A's "normal result, not an error" philosophy.
- The link index is keyed by `calendarEventId` **alone** (single partition key), so a second user's link overwrites the first's — a **pre-existing** limitation shared with the HTTP handler, documented by the new cross-user test, not introduced here.
- `alreadyExists` echoes the **stored link's** authoritative times, not caller input; the stored noteId is `TryParse`d (malformed → version 0, never a 500).
