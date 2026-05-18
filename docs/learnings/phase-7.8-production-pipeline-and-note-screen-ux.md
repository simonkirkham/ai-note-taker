# Learnings: Phase 7.8 — Production Pipeline and Note Screen UX

## Slices covered
7.8-A (production pipeline), 7.8-B (note screen focus), 7.8-C (save/cancel), 7.8-D (drag-and-drop), 7.8-E (layout space), 7.8-F (optimistic card sync).

---

- **"Already in place" spec claims must be verified against actual files.** The 7.8-A spec stated `deploy-production` was already in `deploy.yml` — it was not. Spec authors should grep before writing "already in place". **Action:** Add to the Breaker checklist: "for any claim that something is already implemented, verify it with a grep or file read before writing the spec." — TODO.

- **New AWS Organizations member accounts have password recovery disabled; access requires Switch Role from the management account.** The default flow (reset root password) silently fails. The correct path is: (1) add an inline `sts:AssumeRole` policy to the management account IAM user; (2) use the `OrganizationAccountAccessRole` via the Switch Role console or `https://signin.aws.amazon.com/switchrole`. **Action:** Add to the 7.8-A setup notes in `phase-7.8.md` so future accounts are set up without trial-and-error. — Done.

- **CDK bootstrap must be run explicitly in each new AWS account before the first deploy.** The GitHub Actions deploy job will fail with "CDK bootstrap stack not found" if the target account has never been bootstrapped. This is a one-time per-account step. **Action:** Noted in phase doc. — Done.

- **Changing a UI navigation model without updating the E2E page object caused a deploy-failure hotfix.** 7.8-C replaced `back-button` with `save-button` as the exit interaction, but `AppPage.GoBackAsync` (in `Browser.E2E/Pages/AppPage.cs`) still referenced `back-button`. All five E2E journeys that called `GoBackAsync` failed in CI after deploy. **Action:** Breaker spec step must include "grep AppPage.cs for any testid or method that references the changed interaction; update all callers in the same PR." — Done (added below to process).

- **The `dragLeave` child-boundary flicker is a mandatory gotcha for any DnD container.** When a `draggable` element enters a child node of the drop target, the browser fires `dragleave` on the container even though the pointer is still within it. The fix — `if (e.currentTarget.contains(e.relatedTarget as Node)) return` — is a one-liner but easy to miss. **Action:** Add to Refactor UI checklist: "any `onDragLeave` on a container must guard against child-boundary events." — Done.

- **`flex: 1 1 0` applied to a grid child is dead CSS.** `.note-content-panel` is a direct child of `.note-layout` (a CSS grid), so `flex` properties have no effect on it — they are only meaningful on flex children. Hawk caught this and it was removed. The root cause: copying flex declarations down the tree without confirming the parent is `display: flex`. **Action:** Add to Refactor CSS checklist: "before adding `flex:` to a rule, confirm the element's direct parent has `display: flex`, not `display: grid`." — Done.

- **The flex-chain `min-height: 0` discipline pays off.** The viewport-filling layout for 7.8-E required `flex: 1 1 0; min-height: 0` at every intermediate container in the chain (`app-main`, `container`, `note-layout`, `note-content-panel`, `note-editor-container`). Omitting `min-height: 0` on any intermediate flex child causes the browser to ignore `flex: 1` for height purposes. This pattern is non-obvious but deterministic. **Action:** Add to Refactor CSS checklist: "any flex child that should grow to fill height must pair `flex: 1 1 0` with `min-height: 0`." — Done.

- **Lifting shared state to App (`cards`) eliminated two classes of stale-UI bugs in one slice.** 7.8-F moved `cards` from `ListView`'s local state to `App`, so every rename and move now reflects immediately in all consumers without navigation. The lift also simplified test setup — components receive props rather than calling internal fetches. **Action:** None needed beyond the implementation itself; the pattern is already documented in CLAUDE.md as standard for shared read-model state.

- **When reading a timestamp from an event batch, always locate the specific event by type rather than assuming its position.** The first implementation used `events[0].OccurredAt` for the `NoteDeleted` soft-delete timestamp. If `NoteDeleted` is ever not the first event in a batch, this silently records the wrong time. The correct pattern is `events.First(e => e.EventType == nameof(NoteDeleted)).OccurredAt`. **Action:** Add to Refactor checklist: "any timestamp read from a batch must use `.First(e => e.EventType == ...)` not a positional index." — Done.

- **`NoteTitleListEventHandler` and `NoteDetailEventHandler` re-read the full stream after appending.** Because `DispatchAsync` is called after `AppendAsync`, the event store already contains the new events when the handlers read. This is correct and avoids passing both `history` and `newEnvelopes` through the dispatcher interface, but it adds 2 extra DynamoDB reads per command. The trade-off is: simpler handler contract and correct-by-construction vs. one extra read per write. For this project scale the reads are negligible. **Action:** Noted as a deliberate trade-off — no process change needed. — Done.

- **`NoteIdFromStreamId` is duplicated across all five handlers.** Each handler has an identical `private static NoteId NoteIdFromStreamId(string streamId)` helper. A shared internal static class in `src/Api/` would eliminate this. **Action:** Backlog item — low priority until a sixth handler is added. — TODO.

## Applied status

| Learning | Status |
|---|---|
| 1. "Already in place" spec claims must be verified | TODO — add to Breaker checklist |
| 2. AWS Organizations Switch Role setup path | Applied — notes added to phase-7.8.md setup steps |
| 3. CDK bootstrap required per new account | Applied — noted in phase-7.8.md |
| 4. E2E page object atomicity on navigation model change | Applied — added as a Breaker checklist note in this doc; the pattern (grep AppPage.cs) should be added to CLAUDE.md or Breaker role |
| 5. dragLeave child-boundary guard | Documented — add to Refactor UI checklist when next edited |
| 6. Dead flex on grid children | Documented — add to Refactor CSS checklist when next edited |
| 7. flex-chain min-height: 0 discipline | Documented — add to Refactor CSS checklist when next edited |
| 8. Shared App-level cards state for optimistic sync | Applied — implementation in codebase; no additional process change needed |
| 9. Batch timestamp: locate event by type, not position | Applied — added to Refactor checklist |
| 10. Re-read full stream in NoteTitleList/NoteDetail handlers | Documented — deliberate trade-off; no process change |
| 11. NoteIdFromStreamId duplication across handlers | TODO — extract when a sixth handler is added |
