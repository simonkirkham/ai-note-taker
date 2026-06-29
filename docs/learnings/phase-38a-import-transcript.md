# 38-A — Import a transcript manually

**Shipped:** PR #352, deploy #658, 2026-06-26. Phase 38 complete (single-slice phase).

**What:** paste transcript text from an external tool → a note that runs the same analysis (summary/action items/tags) as a recording. New `POST /w/{ws}/notes/import-transcript`; reuses the recorded-note events minus audio (`NoteCreated → TranscriptionCompleted → analysis`) — no new event/command.

## The reusable whys

### 1. "Create + act in one flow" under an async projector → do it server-side, feed the action its input directly
The obvious client design (create note → set transcript → analyse, 3 calls) **races the async `NoteDetail` projection**: since Phase 27-RYW the projector is async, so `analyse` — which reads the transcript from `NoteDetail` — would `422 NothingToAnalyse` on a note created milliseconds earlier. A recorded note hides this only because recording takes seconds.

Fix pattern: **one server-side handler on the Command Lambda** that appends to the strongly-consistent event stream and passes the just-written value to the next step **directly**, never through the projection. Here `TranscriptImportService` calls `AnalyseAsync(transcriptOverride: pastedText)` — the `transcriptOverride` path (built for the diarization Lambda) already bypasses the projection read. The general rule: *when one request both creates an entity and acts on it, the action must not read the entity back from an async projection — thread the data through, or read the event stream.* (Same family as the BUG-30 "never authorize against an async projection" guardrail.)

`AnalyseAsync` gained a null-detail-with-override branch (detail null **and** non-empty override → analyse the override with empty content/tags); the recorded path (detail present) is byte-unchanged. The in-memory test double can't exercise the lag (its `SyncProjectingEventStore` applies inline), so a dedicated `LaggingNoteDetailStore` (GetAsync → always null) test proves the override branch — the only honest way to cover the prod-only race below the deploy gate.

Consistency token returned at the **post-analysis** version (via a new no-append `INoteCommandHandler.GetCurrentVersionAsync`), so the client's first gated read shows the finished, analysed note — not just the transcript.

### 2. A focus-trap with an unstable `onClose` steals focus on every keystroke
`useFocusTrap(ref, {onClose})` focuses the first focusable element on mount **and re-runs its effect whenever `onClose`'s identity changes**. A modal that recreates `onClose` each render (e.g. `const requestClose = () => { if (!isPending) onClose() }`) re-runs the trap on **every keystroke** (each `setText` re-renders) → focus is yanked to the first focusable (the ✕ close button). Then a typed **space** activates the now-focused button → the modal closes mid-typing. Caught in Refactor via the component test (typing "pasted transcript" — the space triggered it). **Fix: `useCallback` any handler passed to `useFocusTrap`** (deps on the real gate, e.g. `[isPending, onClose]`). This was a real user-facing bug, not just a test artifact. Also: the modal must be a **separate component the parent mounts conditionally** (`{open && <Modal/>}`) — a trap effect inside an always-mounted component never activates on open (the effect already ran with a null ref).

### 3. A red *shared* deploy gate is a call to ACTION, not a reason to park
This slice stalled for hours behind **two unrelated red main deploys** (39-A's `ActionEditJourney` temp-id 404; 37-A's `TodoReorderJourney` RYW persistence bug = BUG-39). My first instinct was to park ready-to-merge and ask the human. **Wrong default** (owner-codified mid-slice as memory + a CLAUDE.md convention): a shared red gate blocks *every* slice and session, so drive it green yourself — fix it (even another slice's failure) **or** apply the concrete unblock step (re-run a genuine flake; quarantine a confirmed-real journey + file the bug). Re-running is only valid for a *flake* — both blockers here failed ≥2× deterministically, i.e. real bugs; the right unblock was the quarantine the 37-A session applied (#357), not more re-runs. Reserve stop-and-ask for genuinely destructive/ambiguous calls.

## Smaller notes
- **Route-contract slice verification:** this app fronts a single Lambda via API Gateway `$default`/`{proxy+}`, so `aws apigatewayv2 get-routes` shows **no** per-path routes — they live in the Lambda. Verify a new route in prod with an **unauth HTTP probe**: `401` = route live + auth required; `404`/`405` = missing/wrong method. (`POST .../import-transcript` → 401 ✅.)
- **Heavy parallel churn = docs-only conflicts, mostly.** 3 `origin/main` merges; every code file auto-merged — all conflicts were `roadmap.md` / phase-doc add/adds. Resolve by keeping main's entries + re-inserting your own in numeric order; take `--theirs` for other sessions' phase docs, `--ours` for yours (preserve the user-requested Value statement).
- **`web/tsconfig.app.tsbuildinfo` is tracked and dirties on every `tsc`/`npm`**, forcing a `git checkout --` before each merge/commit. It is a build cache and should be gitignored + `git rm --cached`. Deferred (repo-wide change, risky during this churn) → candidate technical-improvement.
