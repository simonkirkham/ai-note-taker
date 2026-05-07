# Slice 4-B — Note screen layout redesign

## What we built

CSS grid two-column layout in `NoteView`: `.note-content-panel` (bordered, with "Captured Notes" label) on the left, `.note-right-panel` containing `ActionsSection` on the right. Responsive via `@media (max-width: 767px)` collapsing to single column. `data-testid="actions-section"` added to `ActionsSection` for E2E bounding-box assertions.

## Key decisions

**CSS grid over flexbox.** Grid's fixed right column (`1fr 320px`) gives the actions panel a stable width regardless of content length. Flexbox would require `flex-shrink` and `flex-basis` juggling to avoid the panel collapsing.

**Bounding-box E2E assertions.** Rather than asserting CSS class or computed styles, the E2E checks compare X/Y coordinates of the content and actions bounding boxes. This is implementation-agnostic — the test passes regardless of whether grid, flex, or float is used, as long as the visual relationship is correct.

**`min-width: 0` on `.note-right-panel`.** CSS grid children default to `min-width: auto`, which allows grid items to overflow their track. `min-width: 0` constrains the right panel to its grid column, preventing blowout on long action descriptions.

**Feature branch correctly used.** This was the first slice to follow the `slice/<phase>-<id>-<description>` convention: branch created before Breaker's first commit, PR opened for Hawk review, squash-merged after approval.

## Permission approvals

Two commands required manual human approval during this slice. Both fixed:

1. **`cd C:\code\ai-note-taker\web; npm run build`** — `cd` not in allow-list. Fixed by switching to `npm --prefix <path> run build` (starts with `npm`, already allowed). Guardrail added to CLAUDE.md.

2. **`Remove-Item C:\code\ai-note-taker\pr-body-4b.md`** — `Remove-Item` not in allow-list (correctly — destructive). Root cause: wrote `gh pr create` body to a temp file to work around PowerShell's lack of `<<EOF`. Fixed by using a PowerShell here-string variable (`$body = @"..."@; gh pr create --body $body`) — no temp file, no `Remove-Item`.

## What went wrong

**CI E2E pipeline failure (pre-existing flaky test).** `TodoCompleteJourney.Completing_todo_from_home_removes_it_and_reflects_in_note` failed — the same stale-data class of flake noted in 3-B. All 4 new NoteLayoutJourney tests passed. The pre-existing backlog item (add a pre-E2E data-clear step) still applies.
