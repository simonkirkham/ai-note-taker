# Learnings: 10-F Capture remote participants (system audio mix)

> Resumed after a VS Code crash. The slice was at the Breaker→Pip hand-off: the three red BDD tests existed (uncommitted) in the worktree; no production code. This session was Pip implementation + one Hawk round-trip + merge/deploy + Scribe.

- `getDisplayMedia` originally sat after the credentials and mic `await`s, risking transient-user-activation expiry and a silent mic-only degrade (Hawk finding). **Action:** request call audio first and `console.warn` the swallowed rejection; codified both as rules in the frontend-react skill's "Audio in the browser" section — Done.
- The mid-setup stopped-guards hand-rolled their own `getTracks().stop()` instead of using `cleanup()`, leaving stale stream refs (Hawk finding). **Action:** assign stream refs before each stopped-check and route every early return through the single `cleanup()` path — Done (in slice code, pre-merge).
- Inspecting the in-flight 10-G worktree, `find tests/Analysis.Eval -type f` dumped ~150 lines of `bin/`+`obj/` build artifacts into context — pure token cost. **Action:** when enumerating an untracked .NET project, exclude build output (`-not -path '*/bin/*' -not -path '*/obj/*'`) — Documented (habit; not a config change).
- `SendMessage` is unavailable in this harness, so the second Hawk review could not continue the first reviewer's context and was respawned fresh with the prior findings + fix summary passed in the prompt. **Action:** for a re-review, spawn a new `agent-skills:code-reviewer` and inline the previous findings — Documented.
- The other in-flight Phase 10 slice, **10-G** (analysis eval harness), is ~40 commits behind main and carries a scope inconsistency: the phase doc widens `NoteAnalysisResult` with `ModelId`/`PromptVersion`, but `EvalRunnerTests`' `StubBedrock` still constructs the 3-arg `NoteAnalysisResult` / uses the 3-arg `AnalyseAsync`. **Action:** before resuming 10-G, bring the branch up to date with main and reconcile the StubBedrock signatures with the widened record — TODO (human authorises Pip start).
- Stylist (ui-ux-pro-max) was skipped: the change is a single checkbox + hint styled to match the existing `transcription-update-content-toggle`. **Action:** none — a styled-to-match micro-addition does not warrant a full design-system pass; flag here for visibility — Documented.
- **Post-deploy:** the slice shipped requesting `getDisplayMedia({audio:true, video:false})`, which Chromium rejects with `NotSupportedError` — so call audio silently never worked in a real browser. The BDD test asserted `video:false` and the jsdom mock happily resolved it, so green specs proved only the wiring, not the real API contract. The `console.warn` added during Hawk review is what surfaced it on the first real-browser test. **Action:** fixed to `video: true` (PR #113); added a frontend-react skill rule (`getDisplayMedia` needs `video:true`; verify media-capture APIs in a real Chromium browser before marking a capture slice Done) — Done.

## Applied status

| Learning | Status |
|---|---|
| 1. getDisplayMedia ordering + observable silent fallback | Applied — frontend-react SKILL.md "Audio in the browser"; slice code |
| 2. Unify mid-setup teardown on cleanup() | Applied — useTranscription.ts (pre-merge) |
| 3. Exclude bin/obj when enumerating untracked .NET dirs | Documented — habit, no config surface |
| 4. Respawn Hawk fresh for re-review (no SendMessage) | Documented — harness limitation |
| 5. 10-G stale + StubBedrock scope inconsistency | TODO — handle when 10-G is resumed |
| 6. Stylist skipped for styled-to-match micro-change | Documented — judgment call recorded |
| 7. getDisplayMedia needs video:true; verify media APIs in a real browser | Applied — fix PR #113 + frontend-react SKILL.md rule |
