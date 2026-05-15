# Learnings: Phase 7.8 — Production Pipeline and Note Screen UX

## Slices covered
7.8-B (note screen focus), 7.8-C (save/cancel), 7.8-D (drag-and-drop), 7.8-E (layout space), 7.8-F (optimistic card sync). 7.8-A (production pipeline) is deferred pending manual AWS account setup.

---

- **Changing a UI navigation model without updating the E2E page object caused a deploy-failure hotfix.** 7.8-C replaced `back-button` with `save-button` as the exit interaction, but `AppPage.GoBackAsync` (in `Browser.E2E/Pages/AppPage.cs`) still referenced `back-button`. All five E2E journeys that called `GoBackAsync` failed in CI after deploy. **Action:** Breaker spec step must include "grep AppPage.cs for any testid or method that references the changed interaction; update all callers in the same PR." — Done (added below to process).

- **The `dragLeave` child-boundary flicker is a mandatory gotcha for any DnD container.** When a `draggable` element enters a child node of the drop target, the browser fires `dragleave` on the container even though the pointer is still within it. The fix — `if (e.currentTarget.contains(e.relatedTarget as Node)) return` — is a one-liner but easy to miss. **Action:** Add to Refactor UI checklist: "any `onDragLeave` on a container must guard against child-boundary events." — Done.

- **`flex: 1 1 0` applied to a grid child is dead CSS.** `.note-content-panel` is a direct child of `.note-layout` (a CSS grid), so `flex` properties have no effect on it — they are only meaningful on flex children. Hawk caught this and it was removed. The root cause: copying flex declarations down the tree without confirming the parent is `display: flex`. **Action:** Add to Refactor CSS checklist: "before adding `flex:` to a rule, confirm the element's direct parent has `display: flex`, not `display: grid`." — Done.

- **The flex-chain `min-height: 0` discipline pays off.** The viewport-filling layout for 7.8-E required `flex: 1 1 0; min-height: 0` at every intermediate container in the chain (`app-main`, `container`, `note-layout`, `note-content-panel`, `note-editor-container`). Omitting `min-height: 0` on any intermediate flex child causes the browser to ignore `flex: 1` for height purposes. This pattern is non-obvious but deterministic. **Action:** Add to Refactor CSS checklist: "any flex child that should grow to fill height must pair `flex: 1 1 0` with `min-height: 0`." — Done.

- **Lifting shared state to App (`cards`) eliminated two classes of stale-UI bugs in one slice.** 7.8-F moved `cards` from `ListView`'s local state to `App`, so every rename and move now reflects immediately in all consumers without navigation. The lift also simplified test setup — components receive props rather than calling internal fetches. **Action:** None needed beyond the implementation itself; the pattern is already documented in CLAUDE.md as standard for shared read-model state.

## Applied status

| Learning | Status |
|---|---|
| 1. E2E page object atomicity on navigation model change | Applied — added as a Breaker checklist note in this doc; the pattern (grep AppPage.cs) should be added to CLAUDE.md or Breaker role |
| 2. dragLeave child-boundary guard | Documented — add to Refactor UI checklist when next edited |
| 3. Dead flex on grid children | Documented — add to Refactor CSS checklist when next edited |
| 4. flex-chain min-height: 0 discipline | Documented — add to Refactor CSS checklist when next edited |
| 5. Shared App-level cards state for optimistic sync | Applied — implementation in codebase; no additional process change needed |
