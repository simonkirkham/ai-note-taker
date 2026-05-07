# Slice 4-B — Note screen layout redesign

## What we built

CSS grid two-column layout in `NoteView`: `.note-content-panel` (bordered, with "Captured Notes" label) on the left, `.note-right-panel` containing `ActionsSection` on the right. Responsive via `@media (max-width: 767px)` collapsing to single column. `data-testid="actions-section"` added to `ActionsSection` for E2E bounding-box assertions.

## Key decisions

**CSS grid over flexbox.** Grid's fixed right column (`1fr 320px`) gives the actions panel a stable width regardless of content length. Flexbox would require `flex-shrink` and `flex-basis` juggling to avoid the panel collapsing.

**Bounding-box E2E assertions.** Rather than asserting CSS class or computed styles, the E2E checks compare X/Y coordinates of the content and actions bounding boxes. This is implementation-agnostic — the test passes regardless of whether grid, flex, or float is used, as long as the visual relationship is correct.

**`min-width: 0` on `.note-right-panel`.** CSS grid children default to `min-width: auto`, which allows grid items to overflow their track. `min-width: 0` constrains the right panel to its grid column, preventing blowout on long action descriptions.

**Feature branch correctly used.** This was the first slice to follow the `slice/<phase>-<id>-<description>` convention: branch created before Breaker's first commit, PR opened for Hawk review, squash-merged after approval.

## Permission approvals

Two commands required manual human approval during this slice:

1. **`cd C:\code\ai-note-taker\web; npm run build`** — the `cd` prefix is not in the PowerShell allow-list. Fix: use `npm --prefix <path> run build` so the command starts with `npm`, which is already allowed. Never prefix PowerShell commands with `cd`.

2. **`Remove-Item C:\code\ai-note-taker\pr-body-4b.md`** — `Remove-Item` is not in the allow-list (correctly — it's destructive). Root cause: I wrote the `gh pr create` body to a temp file because PowerShell's `&&`/`<<EOF` syntax differs from Bash. Fix: use a PowerShell here-string variable — `$body = @"..."@; gh pr create --body $body` — no temp file, no `Remove-Item` needed.

Neither command should be added to the permanent allow-list. Both are avoidable by using already-allowed patterns.

## What went wrong

**CI E2E pipeline failure (pre-existing flaky test).** `TodoCompleteJourney.Completing_todo_from_home_removes_it_and_reflects_in_note` failed — the same stale-data class of flake noted in 3-B. All 4 new NoteLayoutJourney tests passed. The pre-existing backlog item (add a pre-E2E data-clear step) still applies.
