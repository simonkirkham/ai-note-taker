# 41-B — Authorizing a child-entity write: own the object, not its parent

**Slice:** 41-B (PR #364, deploy #667, 2026-06-26) — MCP action-item write tools (add / complete / reopen).

## The non-obvious why

**For a write on a child entity addressed by its own id, authorizing the *parent* you were handed is not authorizing the *object* you mutate.** The first cut had `complete_action_item(noteId, actionId)` check `OwnsNoteAsync(noteId, sub)` — but nothing bound `actionId` to that `noteId`. So owning *any* note plus knowing *any* `actionId` would complete/reopen it (an IDOR). The `noteId` was a validated-but-decorative parameter.

**Fix:** authorize the object's *own* owner. Added `IActionItemAuthorizer.OwnsActionAsync` — the action's owner is the `UserId` stamped on its first event (`ActionItemAdded`), read from the action's event stream (strongly consistent, BUG-30-safe), mirroring `INoteAuthorizer` exactly. Then drop the `noteId` parameter entirely: `complete_action_item(actionId)` / `reopen_action_item(actionId)`. Removing the unbound parameter is *stronger* than adding a binding check — there is no longer a substitutable value to attack.

**Distinction that matters:** `add_action_item` legitimately stays note-scoped (`OwnsNoteAsync`) — it *creates* a fresh action attached to a note you own, so there is no pre-existing object to own yet. The asymmetry is correct: create authorizes the parent, mutate authorizes the object.

**Generalises:** any time a write tool takes `(containerId, itemId)` and authorizes the container, ask "could I pass a container I own with someone else's item?" If the handler reads only `itemId`, the answer is yes. Either bind item→container or authorize the item directly.

## The same gap exists on the HTTP surface — filed, not silently inherited

The HTTP `POST /notes/{noteId}/actions/{actionId}/complete|reopen`, `…/edit`, `…/delete` have the identical pattern (authorize the route `noteId`, handler reads only `actionId`). Filed as **BUG-41** (high-priority fast-follow) with the new `IActionItemAuthorizer` as the ready-made fix, rather than expanding the MCP slice. Mirroring an existing gap is not a reason to ship a new one — 41-B was the slice introducing action-write auth, so it got the binding right and flagged the older surface.

## Process notes

- **A red deploy gate on an unrelated test is still a flake to drive green, not wait on.** Deploy #667 failed at the E2E gate on `CreateAndListNoteJourney` — a post-create list assert racing the async projector, a path 41-B never touches. Re-ran the failed jobs (`gh run rerun --failed`); green, `deploy-production` succeeded. Filed the journey's missing reload-tolerance as **BUG-42** rather than shrugging it off — a deploy-gate flake also *skips production deploy*, so a slice sits in the test env until a rerun is green.
- **Hawk's REQUEST CHANGES was the value-add of the review.** The IDOR was not visible from the happy-path tests (which all passed); the cross-user test that *proves* the binding (`CompleteActionItem_OnAnotherUsersAction_IsRejected`, passing only `{ actionId }` with the other user's token) was added *with* the fix — a test that would have passed the mutation before.
