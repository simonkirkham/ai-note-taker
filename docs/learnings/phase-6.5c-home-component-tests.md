# Phase 6.5-C — Home Screen Component Tests

**Slice:** 6.5-C  
**Merged:** 2026-05-15  
**PR:** #38

---

## What we built

Component tests for `NoteCard`, `TagFilter`, and `TodoSection` using Vitest + RTL + MSW. Deleted 4 E2E journey files and pruned 12 now-unused `AppPage.cs` helpers.

---

## Learnings

### 1. Hawk catches false-positive risk even in sequential async code

Hawk flagged that `TodoSection`'s "completing removes it from the list" test could pass even if the POST was never made — optimistic-remove could hide network call failure. Looking at the component, `setItems` is actually called **after** `await completeAction(...)`, so the optimistic-update concern was overstated. But Hawk's instinct was right: the test only asserted on the DOM outcome, not that the API was called. Adding a closure variable `completeCalled` verified the POST fired. This pattern is worth applying whenever a test checks a side-effect that the component could produce through multiple code paths.

### 2. Negative-space tests anchor conditional rendering contracts

Hawk asked for a test that `NoteCard` renders **no** `.note-card-snippet` when `contentPreview` is empty. Without it, a regression that always renders the snippet would still pass the positive test. The `container.querySelector('.note-card-snippet')` assertion is a cheap, high-value guard for any `{condition && <element>}` pattern.

### 3. Layered TagFilter tests: isolated first, integrated second

Testing `TagFilter` in full isolation (all props controlled, callbacks as spies) makes failures easy to diagnose. The integration test through `ListView` is reserved for the one non-trivial behaviour the isolation test cannot cover: whether filtering actually hides cards. This two-level approach — isolate the component, then wire it through its real parent for the integration concern — is the right default for presentational components with complex parent interactions.

### 4. FillAsync("") on React-controlled textarea is intermittently unreliable in E2E

`NoteContentJourney.Clearing_content_and_blurring_saves_empty_content` failed three deploy runs in a row after the test data cleanup started running consistently. The symptom: the content textarea showed `"original content"` even after `FillAsync("")` + `BlurAsync()`. The `ConsistentRead` fix (see below) resolved the `NoteDateJourney` timeout; the content test turned out to be flaky Playwright/React interaction — it passed on re-run. If this recurs, the fix is to replace `FillAsync("")` with `TriplClickAsync()` + `keyboard.press("Delete")` in the AppPage helper, which is more reliable for clearing controlled inputs.

### 5. DynamoDB event store must use ConsistentRead on reads

The `NoteDateJourney` was failing with a 30 s timeout because `RenameNote` was called so quickly after `CreateNote` that the event store `ReadAsync` (without `ConsistentRead=true`) returned an empty history, throwing `NoteNotFoundException` and rolling back the optimistic title. Fixed by adding `ConsistentRead = true` to `DynamoDbEventStore.ReadAsync`. All command handler reads on an event store must be strongly consistent — eventual consistency is only acceptable for projection **reads** that power query endpoints.

### 6. Stale empty-string attributes in DynamoDB cause silent projection failures

`DynamoDbNoteDetailStore` was storing `{S: ""}` for empty `Content`. AWS SDK v4 may reject empty S attributes (or the DynamoDB service rejects them), causing `PutItemAsync` to throw after the event was already appended to the event store — a split-brain state. Fixed by storing `{NULL: true}` for empty strings and reading back as `""`. Pattern: always guard DynamoDB S attributes with `string.IsNullOrEmpty` checks and use `NULL = true` as the sentinel.

---

## Immediately-applied fixes

- `ConsistentRead = true` added to `DynamoDbEventStore.ReadAsync` (PR #39, merged before 6.5-C)
- `DynamoDbNoteDetailStore` null-guards for empty Title/Content (PR #39)
- Integration test added: `PutContent_ClearingToEmpty_PersistsEmptyAndReturnsItOnGet`
