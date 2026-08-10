# 50-B — two writes, one stream: the pairing is the risk, not the feature

**Slice:** 50-B, "Move to Today / Move to Later" from a per-row actions menu.
**Shipped:** PR #446, deploy #747, 2026-08-10. Command Lambda verified live in prod 01:08:22Z.

The feature was a menu. The cost was a production concurrency bug the feature would have
detonated, found in review, invisible to every gate — and to my own specs.

## What was actually wrong

`TodoOrderCommandHandler` was the **only** command handler with no append retry:

```csharp
var history = await store.ReadAsync(streamId, ct);
var newEvents = RebuildAggregate(history).Handle(cmd);
await store.AppendAsync(streamId, history.Count, envelopes, ct);   // no catch, no retry
```

Three facts combine into the bug:

1. Its stream is **stable-id** — `todo-order#{workspaceId}`, one partition for every ordering
   write in the workspace. Not a per-entity stream that rarely contends.
2. 50-B's "Move to Later" deliberately issues a `ReorderTodos` **and** a `SetTodayLine` in the
   same tick, so the row and the line move together optimistically. The pair races *itself*.
3. A lost race threw the raw `ConcurrencyException` → **409**, which the client treats as a
   duplicate/no-op and swallows. A lost write, silently.

So the primary path of the new feature was a coin flip, and the failure mode was invisible.

## Why nothing caught it

| Gate | Why it was blind |
| --- | --- |
| Domain specs | Pure aggregate; no store, no concurrency |
| `Api.Integration` | Drives one client sequentially — there is no second writer |
| My own 50-B specs | **The demote spec picked the row adjacent to the line**, so `from === to`, no reorder was posted, and the racing branch had *zero* coverage |
| PR CI | E2E only runs in the deploy gate |
| The deploy gate | Would probably have gone red — the new journey adds a to-do at the top and demotes it, which is exactly the racing pair |

The fixture choice is the sharp lesson. "Moving a Today item to Later lands it FIRST in Later"
passed, looked like it proved the demote, and exercised the one branch that *cannot* race.
Picking `Three` (last in Today) instead of `One` was the difference between covering the feature
and covering the boundary case that skips it.

## The fix, and the fix's own bug

Round 1: add the bounded read-rebuild-append retry `NoteCommandHandler` has always had
(6 attempts, exponential backoff + jitter, `WriteContentionException` → **503** on exhaustion —
never 409, which the client reads as "give up, it's fine").

Round 1 also tried to make the client-side pair atomic by snapshotting the whole todo list before
the writes and restoring it if either half failed. **That was worse than the problem.** Review
round 2 caught two things:

1. It fixed the *cache*, not the server. With one write persisted, the user was told "it's back
   where it was" while the server disagreed — and with `staleTime: 30s` and no refetch, that lie
   could sit there indefinitely.
2. A whole-list restore **clobbers unrelated writes** made during the round trip. Completing a
   to-do or quick-adding one is not gated on the moving row's busy flag, so those writes had
   already landed server-side and the snapshot silently reverted them locally.

The right answer was to stop trying to be atomic on the client at all: on any half-failure,
`invalidateQueries` and show whatever actually saved, with a message that asserts nothing the
refetch can contradict. The per-mutation rollback was correctly narrow; my snapshot wasn't.

## Rules banked

1. **When a slice pairs two writes to one stream, the pairing is the risk — audit the handler's
   contention behaviour before writing a line of UI.** Ask "what happens when these two race?"
   not "does each one work?"
2. **A client cannot make two independent appends atomic.** Don't fake it with a snapshot.
   Either make it one command (one `AppendAsync`), or refetch and report honestly. A restore that
   force-writes a whole cached collection will clobber concurrent writes to that same collection.
3. **Pick the test fixture that exercises the branch, not the one adjacent to it.** If a
   parameter choice makes a code path degenerate (`from === to`), the spec proves nothing about
   the path it names. Assert the request body, not just the rendered result — a spec that never
   posts is indistinguishable from one that posts correctly, if you only check the DOM.
4. **A retriable failure must not share a status code the client treats as success** — the BUG-27
   rule, re-earned. 409 means "duplicate, ignore"; contention means "try again" and must be 503.
5. **`aria-disabled`, not `disabled`, on menu items.** A `disabled` button cannot take focus, so
   when the *first* action is unavailable (all are, mid-save) focus never enters the menu, the
   arrow keys do nothing, and Escape — handled on the popup — never fires. The menu becomes a
   keyboard trap precisely when the user most wants out. And when you make that switch,
   **change the CSS with it**: `[disabled]` selectors silently stop matching, so unavailable
   actions render fully enabled with a hover highlight and a pointer cursor.

## Process notes

- **The prototype paid for itself in one message.** Four control shapes offered as ASCII in an
  `AskUserQuestion` got "I can't tell the difference between them". The same four, running at
  `/prototype`, got "D" — one character. When the human has asked to prototype, the running page
  *is* the question; don't put the design choice in text first.
- **Never run the full vitest suite concurrently with `tsc`/`eslint` on WSL.** Contention produced
  12 failures across 10 unrelated files (1204 s); the same suite alone was 969/969 in 176 s. Run
  the frontend gates sequentially, and re-run alone before believing scattered timeouts.
- **A fresh worktree cannot `cdk synth`** until `Projector` and `TranscribeCompletion` are also
  published to `bin/Release/net10.0/publish` — the pre-commit hook's synth step fails otherwise.
  Worth adding to the worktree setup step alongside `dotnet restore` + `npm install`.
- **Don't `rm -rf node_modules` while a background install is still running** — it half-deletes the
  tree and leaves `ls` reporting 0 entries with binaries still present. Confirm the install
  finished first.

## Also closed here

50-A's acceptance criterion *"the line's position survives a reload"* had a passing unit spec for
the write but **no executed proof of the reload** — 50-A merged during the 2026-08-06 GitHub
Actions outage and its E2E never ran. `TodayLineJourney` now proves it end to end (E2E 29 → 30
journeys, all green on deploy #747). Phase 50 closes with every acceptance criterion having a run
test behind it, not just a written one.

## Follow-up filed

[TI-66] — three command handlers now carry the same read-rebuild-append retry, and the fact that
one of them was *silently missing it* is the whole argument for extracting a shared
`AppendWithRetryAsync`. Deliberately not done here: it would touch two handlers this slice has no
other reason to change.
