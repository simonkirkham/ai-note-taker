# Phase 6.5-D — Note View Component Tests

**Slice:** 6.5-D  
**Merged:** 2026-05-15  
**PR:** #40

---

## What we built

Component tests for `NoteView`, `ActionsSection`, and `Sidebar` using Vitest + RTL + MSW. Deleted 8 E2E journey files and pruned 21 now-unused `AppPage.cs` helpers. Browser.E2E is now trimmed to exactly 5 kept journeys.

---

## Learnings

### 1. `vi.useFakeTimers()` without `{ shouldAdvanceTime: true }` blocks async operations

`vi.useFakeTimers()` replaces `setTimeout` globally, including the timers used by jsdom, MSW, and React's scheduler. Without `{ shouldAdvanceTime: true }`, any `await` that internally relies on a timer never resolves, causing the test to time out. Once a test leaves fake timers active (e.g. via an uncaught timeout), every subsequent test in the same file inherits them — a single fake-timer leak silently kills the rest of the suite.

Fix: always use `vi.useFakeTimers({ shouldAdvanceTime: true })` and add a module-level `afterEach(() => vi.useRealTimers())` as a defensive teardown, even if only one test uses fake timers.

### 2. Load-triggered auto-mutations must be verified, not just their DOM side-effects

`NoteView` auto-PATCHes `/notes/:id/date` when the API returns `date: null`. The "date defaults to today" test initially only checked the input value — the PATCH could silently fail (or never fire) without failing the test. Adding `let patchCalled = false` inside a `server.use` override and `await waitFor(() => expect(patchCalled).toBe(true))` ensures the mutation is verified. This is the same POST-capture pattern from 6.5-C, but extended to component-mount effects, not just user interactions.

### 3. Stale GitHub Actions runners block the deploy queue for hours

A deploy job started at 07:42 UTC became unresponsive — no job progress, `updated_at` frozen at 07:44, GitHub API returning 502 on job details and 500 on cancel. This blocked 3 subsequent queued deploys for 2+ hours. The only resolution was a manual UI cancel from GitHub's Actions tab. GitHub's API does not reliably reflect the runner's actual state when a runner node is dead; the job appears in_progress indefinitely until manually cancelled or the 6-hour timeout fires.

### 4. GET-call verification is necessary when the test overrides the default handler

The default `handlers.ts` for `GET /notes/:noteId` returns `content: ""`. If a test overrides the handler to return `content: "Meeting notes"` but the override is somehow not matched, the component still renders the textarea (with empty content from state initialisation), and the test passes silently. Adding `let fetchCalled = false` inside the override handler and asserting it was called proves the override actually fired.

---

## Applied status

| Learning | Status |
|---|---|
| 1. `vi.useFakeTimers({ shouldAdvanceTime: true })` + module-level `afterEach` teardown | Applied — used in `NoteView.test.tsx`; pattern codified in Refactor skill (6.5-C component-test section) |
| 2. Load-triggered auto-mutations need closure-variable verification | Applied — `patchCalled` closure added to "date defaults to today" test |
| 3. Stale GitHub Actions runners block deploy queue | Documented — fix requires manual UI cancel; no code change possible |
| 4. GET-call verification when overriding the default handler | Applied — `fetchCalled` closure added to "renders content" test |
