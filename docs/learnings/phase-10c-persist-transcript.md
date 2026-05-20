# Learnings: 10-C — Persist transcript

- Calling `setState` synchronously inside a `useEffect` body triggers `react-hooks/set-state-in-effect`; reading `ref.current` during render triggers `react-hooks/no-refs-in-render`. The correct pattern for "track whether X has happened this session" is `useState` with the setter called in the event handler (`onClick`), not in an effect. **Action:** Item 4 of the pre-PR checklist already requires running `npm --prefix web run lint` — no additional checklist change needed. The fix pattern (`useState` + event handler) is documented here for future reference — Documented.

- Every new `.cs` file in `src/Api/Contracts/` must open with `namespace Api.Contracts;`. A missing namespace compiles via implicit global using but breaks conventions and requires a follow-up `using` in every consumer. **Action:** Added item 7 to Pip's Step 1d pre-PR checklist in `agent-roles.md` — Done.

- Every endpoint dispatching a Note command must catch both `Exceptions.NoteNotFoundException` and `InvalidOperationException`, mapping both to 404. The aggregate throws `InvalidOperationException` for rejected commands (deleted note, race between projection check and dispatch). **Action:** Added item 8 to Pip's Step 1d pre-PR checklist in `agent-roles.md` — Done.

- A `TranscriptionPanel` that receives `initialTranscript` from a parent re-shows the stale saved value after Reset, because `status` returns to `idle` but the parent prop is unchanged. Fix: `useState(false)` flag (`hasRecordedThisSession`) set in the Record button `onClick`; display `initialTranscript` only when `!hasRecordedThisSession`. **Action:** Design pattern documented here — Documented.

- `useTranscription` has two paths that end recording: the Stop button and the natural end-of-stream (`for await` loop exits when AWS closes the stream). Both must call `completeTranscription`. The natural-end path needs its own test with a finite mock stream via `vi.mocked(TranscribeStreamingClient).mockImplementationOnce`. **Action:** Pattern documented here — Documented.

- Empty `transcriptText` must be validated server-side before the projection lookup. Without the guard, a direct API call bypasses the frontend `if (text)` check and stores an empty string in the aggregate event; the DynamoDB conditional then silently drops it, leaving projection and event log inconsistent. **Action:** Pattern documented here — Documented.

- Pip did not run `npm run lint` before pushing. The `react-hooks/set-state-in-effect` error only surfaced in CI after the PR was merged, requiring a follow-up fix PR (#80) that broke and then re-triggered the production deploy. The pre-PR checklist (item 4) already requires this — it was simply not followed. **Action:** No checklist change needed; the rule exists. Reminder: the pre-commit hook at `.githooks/pre-commit` also runs lint — activate it (`git config core.hooksPath .githooks`) in every new worktree — Done (noted in pre-commit hook setup; no code change needed).

- Two Hawk passes cost ~98k tokens combined (~44% of the slice total). The three findings in the first pass — missing namespace, missing `InvalidOperationException` catch, stale `initialTranscript` — are all detectable before opening the PR. Items 7 and 8 above are now in the pre-PR checklist; the stale-prop pattern is harder to generalise. **Action:** Items 7 and 8 added to checklist (Done above). If both first-pass findings had been caught pre-PR, this slice would have had one Hawk pass (~38k) instead of two (~98k), saving ~60k tokens — Documented.

## Applied status

| Learning | Status |
|---|---|
| 1. setState-in-effect / no-refs-in-render | Documented — lint already in checklist item 4; fix pattern recorded here |
| 2. Contract file namespaces | Applied — added item 7 to Pip's Step 1d checklist in `agent-roles.md` |
| 3. Command handler exception coverage | Applied — added item 8 to Pip's Step 1d checklist in `agent-roles.md` |
| 4. Stale initialTranscript after Reset | Documented — design pattern; no checklist rule generalises cleanly |
| 5. Natural end-of-stream test path | Documented — test pattern; no checklist rule generalises cleanly |
| 6. Server-side empty transcript validation | Documented — boundary validation pattern; already general practice |
| 7. Lint not run before push → post-merge fix PR | Documented — rule already exists in checklist item 4; no code change |
| 8. Two Hawk passes (~98k) from pre-PR-catchable findings | Applied — checklist items 7 and 8 address the two mechanical findings; stale-prop documented |
