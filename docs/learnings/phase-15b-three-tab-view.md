# Phase 15-B — Three-tab note view (Transcript / Quick notes / Final notes)

**Shipped:** 2026-06-03 (PR #149, deploy #435 green).

## What shipped

`NoteView` restructured into an accessible three-tab layout — **Quick notes** (default) · **Transcript** · **Final notes** — with the record control inline on the tab row and Tags + Action items in a persistent sidebar visible on every tab. The old `TranscriptionPanel` was decomposed into a new `RecordControl` (record/stop + auto-analyse + call-audio mix; owns `useTranscription`, survives tab switches) and a read-only `TranscriptTab`. Final notes reuses 15-A's `FinalNotesView`. Frontend-only; three new co-located CSS Modules; E2E `data-testid`s preserved.

## What went well

- **Parallel-with-deploy overlap.** 15-B was built while 15-A's deploy ran, and 15-C while 15-B's deploy ran — the safe form of parallelism (build the next slice from already-merged code; the merge gate still serialises landing).
- **Faithful decomposition under test.** Lifting `useTranscription` into `RecordControl` while keeping auto-analyse-on-stop, the call-audio mix, and both toggles working was verified by a dedicated `RecordControl.test.tsx`; Hawk confirmed behaviour parity with the deleted `TranscriptionPanel`.
- **Standards self-audit caught a real gap.** Before pushing, an explicit audit against the `frontend-react` skill caught that the active-tab class used a template-string ternary instead of `clsx` — fixed before review. Colours/radius were already tokenised.

## Process learnings (the big one: concurrent-phase contention)

Phase 15 and Phase 14 ran concurrently and **both rewrote `NoteView.tsx` + `App.css`**. This caused real, repeated friction and is the dominant lesson:

- **Rebase collisions cascaded.** 15-B was cut before Phase 14's #146 (NoteView → CSS Modules) and #148 (TodoSection/ListView → Modules). Each Phase 14 merge re-conflicted 15-B's `App.css`, so a rebase+CI cycle got invalidated before it could land — a **livelock** under a rapid concurrent merge train, made worse because the merge gate forbids merging while any deploy is in progress.
- **Semantic collision, not just textual.** Phase 14-O planned to *migrate* `TranscriptionPanel` to a module while 15-B *deletes* it — incompatible intents on the same file. Resolution required a human-relayed coordination ("pause Phase 14, drop 14-O"); 14-O was then dropped as superseded by 15-B.
- **A clever auto-merge of `App.css` produced malformed CSS.** Resolving the conflict by taking the LCS/common-lines of both deletion-only sides misaligned on the many identical `}` lines (braces 31-open/60-close). **Lesson:** never line-merge CSS by LCS — resolve block-by-block. The reliable fix was: take main's valid `App.css`, then delete the now-dead `.transcription-*` block (verified by brace balance + grep that the classes were unreferenced — the new components used `data-testid`s, not those classes).
- **Cross-session limits.** The orchestrator can only message sub-agents it spawns, **not** an independent concurrent session. Coordination between two human-driven sessions has to go through the human.

**Apply:** do not run two phases concurrently that both rewrite the same hot files (`NoteView.tsx`, `App.css`). Sequence them, or assign file ownership and a merge order up front. If they must overlap, the one with the smaller/foundational change should merge first and the other rebases once at the end. See [[phase-15a-final-notes-artifact]] (same lesson, first observed there).

## Follow-ups

- E2E selectors should be `data-testid`-based, never CSS classes (a CSS-Modules migration previously reddened main by renaming `.note-card`). 15-B preserved/added testids; keep enforcing this.
