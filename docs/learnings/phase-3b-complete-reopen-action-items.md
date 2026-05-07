# Learnings: Slice 3-B — Complete and reopen action items

## What was inefficient or went wrong

- The pipeline ran smoothly with no rework cycles. The 3-A foundations (aggregate, projection, store interface) were solid and the extension was cheap — total tokens roughly half of 3-A.
- The main pipeline failed twice on E2E tests before passing on the third attempt. Both failures were in pre-existing tests (`ActionItemJourney`, `NoteDeleteJourney`) caused by data pollution from previous runs, not by 3-B changes. The "Clear test data" step runs after E2E, so a prior failed run can leave stale notes that cause strict-mode violations or missing-note failures on the next run. This cost two unnecessary re-run cycles.
- The `agent-workflow.md` → `agent-roles.md` consolidation happened in the same session as the slice, adding doc overhead that isn't part of the slice's token cost.

## Suggested process improvements

- **Scribe should flag recurring E2E flakiness** caused by shared database state. A "Clear test data before E2E" step (in addition to the existing after-step) would prevent stale-data failures and eliminate re-run cycles. Scout should add a backlog item to address this.
- **Scout should note structural-only route params in the brief.** The `noteId` in `/notes/{noteId}/actions/{actionId}/complete` is required by REST convention but unused by the command handler. Flagging this in the phase doc prevents Hawk from having to call it out as a finding.

## Hawk review findings

| Finding | File | How to prevent |
|---|---|---|
| `noteId` route param accepted by Complete/Reopen handlers but not used in command | `src/Api/Handlers/ActionItemHandlers.cs:31,45` | Scout can note in the brief that REST convention requires `noteId` in the path but it is not passed to the command — Pip can add a `_` discard or a comment to make the intent explicit |

| Finding | File | How to prevent |
|---|---|---|
| `noteId` route param accepted by Complete/Reopen handlers but not used in command | `src/Api/Handlers/ActionItemHandlers.cs:31,45` | Scout can note in the brief that REST convention requires `noteId` in the path but it is not passed to the command — Pip can add a `_` discard or a comment to make the intent explicit |
