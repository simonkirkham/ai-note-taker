# Slice 3-E — Delete an action item

## What went well

- **Layer-split worked cleanly again.** 5 acceptance criteria triggered the split. Batch 1 (domain/API) fit in ~20k tokens; Batch 2 (E2E/frontend) was even smaller. No context pressure.
- **`_deleted` flag on the aggregate.** Adding a `_deleted` state field closed the gap where completing or reopening a deleted item would have silently succeeded. The flag prevents invalid state transitions without any infrastructure changes — pure aggregate logic.
- **`DynamoDbNoteActionsStore.DeleteAsync` used the correct composite key.** PK=NoteId, SK=ActionId matches the table's composite key schema. Getting this right from the event stream history (via `addedEvent.NoteId`) was the key — the command only carries `ActionId`.
- **Refactor caught a real duplication.** `AssertTodoItemAbsentFromHomeAsync` in `AppPage.cs` was identical to `AssertTodoItemGoneAsync`. Removed in the refactor pass before commit.

## What went wrong

- Nothing significant. Straightforward extension slice.

## Suggestions

- **SVG delete icon (backlog).** The delete button uses `×` (multiplication sign) as its label. For a production product, a small trash-can SVG from Heroicons/Lucide would be more semantic and accessible. Deferred — the existing UI is functional.
- **Touch target (backlog).** `.delete-action-button` uses minimal padding, below the 44px touch target guideline. Same issue as the checkboxes. Consolidate all touch target fixes into a single accessibility slice.
- **`INoteActionsStore.DeleteAsync` signature.** Required both `NoteId` and `ActionId` because the DynamoDB composite key needs both. This leaked the storage model into the interface slightly. An alternative would be a single-key lookup (just `ActionId`) if the table schema were restructured, but the current approach is correct given the existing schema.
