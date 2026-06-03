# Phase 15-A — Final notes artifact (AI stops overwriting user notes)

**Shipped:** 2026-06-03 (PR #144, deploy #431 green).

## What shipped

Analysis stopped gap-filling the user's `content` and instead records a new, first-class `AnalysisSummaryRecorded` event (Summary + DiscussionPoints + Decisions + ModelId + PromptVersion), surfaced via the `NoteDetail` projection / `GET /notes/{id}` and rendered by a new `FinalNotesView`. The `analysis@v2` prompt returns structured output (no `updatedContent`); `BedrockAnalysisService` falls back to an empty summary on malformed JSON without throwing. Tag/action-item provenance and the 503 path are unchanged. Action items deliberately stay in the sidebar, not inside Final notes. Forward-only: existing notes keep their merged content as Quick notes.

## What went well

- **Parallel backend/frontend streams.** Backend (`src/` + `tests/`) and the `FinalNotesView` frontend (`web/`) were built concurrently against the contract the phase doc fixed up front (the new `NoteDetail` JSON fields). Disjoint trees, no git from the sub-streams, orchestrator committed — clean convergence with zero conflicts between the two streams.
- **Event-as-AI-artifact.** A deliberate contrast with Phase 10, where analysis reused existing events to stay authorship-agnostic. Here the split *is* the feature, so provenance is explicit in the model. Snapshot semantics (latest wins), element-wise list equality on the event for spec assertions.
- **Specs-first held.** Domain.Specs + Api.Integration written before implementation; the malformed-JSON-→-empty-summary and "no `ContentEdited` emitted" behaviours were pinned by tests.

## Process learnings (actioned / to apply)

- **npm 11 / Node 24 lock-file churn (recurring).** Both sub-agents' `npm install` rewrote `web/package-lock.json` with `"peer": true` annotations and touched `web/tsconfig.app.tsbuildinfo`. Reverted both before commit per the CLAUDE.md Node-20 guardrail. **Apply:** when an agent runs `npm install` in a worktree, always `git checkout -- web/package-lock.json web/tsconfig.app.tsbuildinfo` unless a dependency was genuinely added. (`tsconfig.app.tsbuildinfo` is a tracked build-cache artifact — a candidate to gitignore.)
- **Red-main blocked the merge.** Main's deploy was red from a concurrent Phase 14 CSS-Modules merge (#143) that renamed `.note-card`, breaking 6 `Browser.E2E` `.note-card` selectors. The merge gate correctly held 15-A until the Phase 14 owner fixed it. E2E only runs in the deploy workflow (not PR CI), so a class-rename regression is invisible until merge — **a class-based E2E selector is fragile; journeys should select by `data-testid`.**
- **Concurrent phases editing the same files = guaranteed rework.** Phase 14 was migrating `NoteView`/`App.css` to CSS Modules at the same time Phase 15 restructures `NoteView`. 15-A's small `App.css` touch was fine, but 15-B (full `NoteView` rewrite) collided head-on with Phase 14 #146. **Apply:** don't run two phases that both rewrite the same hot files (`NoteView.tsx`, `App.css`) concurrently — sequence them, or coordinate file ownership.

## Follow-ups (not blocking)

- DynamoDB round-trip test for the new `NoteDetail` fields (empty-string "analysed but empty" vs null "never analysed") in `EventStore.Integration` — Docker was unavailable locally; CI exercises it but no field-specific assertion exists yet. (Hawk nit.)
- `LastModifiedAt` consistency: `AnalysisSummaryRecorded` bumps it, `TranscriptionCompleted` doesn't — decide deliberately whether an analysis run counts as "modified" for note ordering. (Hawk nit.)
