# Slice 4-C — Implicit action item add

## What we built

Replaced the `<form onSubmit>` + Add button in `ActionsSection.tsx` with a standalone `<input>` driven by `onKeyDown` (Enter) and `onBlur`. The Add button (`data-testid="add-action-button"`) was removed from the DOM entirely. `AppPage.AddActionItemAsync` was updated to use `PressAsync("Enter")` and `AddActionItemByBlurAsync` was added for blur-trigger tests.

## Key decisions

**Guard against double-submit.** `handleSubmitDescription` checks `if (!description || submitting)` before sending the POST. Without this, an Enter keydown followed immediately by a blur (which fires when Enter moves focus) would send two POST requests for the same item.

**`onBlur` fires after `onKeyDown`.** The Enter path sets `newAction("")` to clear the input synchronously, so if `onBlur` fires afterward (focus leaving the input) the `description` guard is already empty — no duplicate submission.

**Page object updated before Pip.** `AppPage.cs` received `AddActionItemByBlurAsync` and the updated `AddActionItemAsync` (Enter-based) before any implementation change. This preserved the Breaker-first rule: the failing test shape was committed before the feature existed.

## What went wrong

Nothing significant. Pure frontend slice — no backend or CDK changes. CI ran green on first attempt.

## Permission approvals

None required. All commands matched existing allow-list entries (`npm --prefix`, `git`, `gh`).
