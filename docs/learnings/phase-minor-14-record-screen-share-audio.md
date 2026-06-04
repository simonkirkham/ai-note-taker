# CHANGE-14 — Rename transcription "Call audio" toggle to "Record screen-share audio"

**Shipped:** PR #164, merge `aacc89f`, deployed 2026-06-04 (deploy #460). Frontend-only, copy change.

## What changed
The transcription recording toggle's visible label changed from **"Call audio"** to **"Record screen-share audio"** (`RecordControl.tsx:110`). The old label didn't convey that enabling the toggle triggers a browser screen-share prompt (`getDisplayMedia`) to capture system/call audio. One-line text change plus a component test asserting the new label. The `data-testid="transcription-call-audio-toggle"`, the `includeCallAudio` state/prop, and the capture/mixing/mic-only-fallback path were all left untouched (internal, not user-facing). No event/projection/API change.

## Technical notes
- The existing `RecordControl` tests query the toggle by `data-testid`, so the label rename didn't break them — and equally meant the rename was *untested* until a new `getByText` assertion was added. When the user-facing string is the whole point of a change, assert on the string explicitly.
- The only other "Call audio" occurrence (`useTranscription.ts:110`) is an internal `console.warn`, correctly left alone — it's a developer log, not user copy.

## Process learnings
- **First end-to-end run of the `run-pipeline` skill in autonomous mode.** CHANGE-14 was already specced in the standing doc, so under the updated skill the slice ran Breaker → Pip → Refactor → PR → Hawk → merge → Scribe with no gate pauses. The model worked well for a trivial, fully-specced item; the pipeline's value here was discipline (worktree, failing-test-first, merge gates) rather than decisions.
- **`npm install` in a fresh worktree rewrote `package-lock.json` (Node 24 local vs CI Node 20).** Reverted before commit so the merge stayed a clean 2-file diff. Reaffirms the existing guardrail — for a slice that adds no dependency, the lock file must never appear in the diff. Consider `npm ci` over `npm install` in worktree setup to avoid the churn entirely. See [[node-version-lockfile-mismatch]].
- **Don't grep a monitor's exit condition for a word the success output also contains.** A deploy/CI watcher `until`-loop used `grep "...error..."` and fired early because the lint summary line "0 errors" contains "error". Match an unambiguous terminal sentinel (a unique `=== ALL DONE ===` marker, or `vitest`'s explicit fail line), not a substring that legitimate output can include.
- **`gh run view` takes the database ID, not the run's display number.** The deploy monitor was given `460` (the display number) and 404-looped forever; the real ID came from `gh run list --json databaseId`. Resolve the `databaseId` once, then watch that. Worth baking into the `run-pipeline` skill's deploy-monitor step.
