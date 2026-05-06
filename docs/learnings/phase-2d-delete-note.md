# Phase 2-D Learnings — Delete a Note

## What we built

`DeleteNote` command, `NoteDeleted` event, prune-on-event projection cleanup, `DELETE /notes/{noteId}` endpoint, and a frontend delete button. The event stream retains the full history; projections hard-delete their DynamoDB rows when `NoteDeleted` is processed.

## What worked well

**Prune-on-event is clean to implement.** Because `NoteCommandHandler.UpdateProjectionAsync` receives the new event envelopes, it can branch on `NoteDeleted` before any projection rebuild — one `DeleteAsync` call per store, early return, done. No special state needed in the in-memory projections; they just `_items.Remove(e.NoteId)` like any other event.

**The aggregate `_deleted` flag keeps guard logic readable.** `!_exists || _deleted` in `HandleRename` and `HandleEditContent` is the complete "note is operable" check. The flag is set by `Apply(NoteDeleted)` and the aggregate never emits `NoteDeleted` a second time (checked in `HandleDelete`).

**Frontend optimistic remove.** `useNotes.remove` awaits `apiDelete`, then filters local state — no stale list item, no page refresh needed. The note disappears immediately after the DELETE completes.

## What was surprising or non-obvious

**`Assert.Empty` is a xUnit2029 analyzer violation.** The CI build with `-p:TreatWarningsAsErrors=true` treats this as an error. `Assert.DoesNotContain(collection, predicate)` is the correct replacement when filtering a collection. The violation wasn't caught locally because `dotnet test` without the `-p:TreatWarningsAsErrors=true` flag only runs tests — it doesn't re-run the analyzer. Always check analyzer rules on CI first if unsure.

**E2E `PageTest` base class doesn't exist in this project's Playwright setup.** The project uses `BrowserFixture` + `IAsyncLifetime` pattern (with per-test context and tracing), not the Playwright `PageTest` convenience base. Using the wrong base class is a build error. Match existing journey test patterns exactly.

**`NoteNotFoundException` vs `InvalidOperationException` in the delete handler.** The stream being empty (note never existed) throws `NoteNotFoundException` from the command handler. The aggregate being in `_deleted` state throws `InvalidOperationException` from the domain. Both should surface as 404. Catching both explicitly keeps the intent clear even though they could be collapsed.

**The not-found detection `err.message.includes("404")` is fragile.** It depends on the `api.ts` error format staying stable. A typed error or a dedicated `NoteNotFoundError` class would be more robust. Flagged by Hawk; deferred given the learning context.

## Workflow notes

- Two CI failures on the first push: wrong E2E base class, and xUnit2029 analyzer error. Fixed in a single follow-up commit.
- Hawk approved with two minor flags (fire-and-forget `onClick`, fragile 404 detection) — neither required a code change before merge.
- Feature branch `slice/2-d-delete-note`, PR #11 merged via squash.
