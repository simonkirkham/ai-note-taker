---
name: phase-11e-delete-note-from-home-screen
description: Learnings from slice 11-E — delete affordance on NoteCard, E2E click target fragility, no-rollback trade-off
metadata:
  type: project
---

# Phase 11-E — Delete Note from Home Screen

## E2E tests should target specific child elements, not the whole container

`ClickNoteInListAsync` originally clicked the entire `.note-card` article. Playwright's `ClickAsync()` clicks the centre of the element's bounding box. Adding a Delete button with `stopPropagation` to the bottom of small cards meant the centre-click could land on the Delete button rather than the card body — showing the confirmation UI instead of navigating to the note, causing the `TagsJourney.AddTag_PersistsAfterNavigation` E2E test to fail.

**Fix:** Changed the E2E locator to `.Locator("h3.note-card-title")` — a specific, stable target within the card's content area that will never be obscured by action buttons.

**How to apply:** Whenever a new interactive element (button, link) with `stopPropagation` is added inside a component that is itself clickable, audit all E2E `ClickAsync()` calls on that component. If they target the whole container rather than a specific child, tighten them to a descriptive child element.

---

## Test architecture shapes component architecture — onDelete callback vs API call

The integration test (`confirming calls DELETE /notes/:noteId`) passed `onDeleteNote={vi.fn()}` as the callback but still expected the DELETE API to be called. This can only pass if the component itself calls the API — not the parent via the callback. As a result, `NoteCard` owns the `deleteNote()` call, and `onDelete` becomes a pure state-update notification for the parent.

**Why:** The test was written to verify end-to-end behaviour (confirm → DELETE) from the component level. Using a plain `vi.fn()` as the callback made the API responsibility unambiguous: the component must call it.

**How to apply:** When writing integration tests for components, be deliberate about whether the callback or the component itself should call the API. A `vi.fn()` callback signals "component owns the API call". A callback with `vi.fn().mockImplementation(async (id) => fetch(...))` signals "parent owns the API call". Misalignment between the test design and the intended architecture will surface as a failing test — which is the right outcome.

---

## Optimistic delete with synchronous onDelete prevents rollback

Calling `onDelete?.()` synchronously (before the API resolves) enables immediate visual removal in the parent and satisfies the "optimistic" acceptance criterion. But it also causes the parent to filter the card from state and unmount the component before the API `catch` can restore it — `setVanished(false)` on an unmounted component is a no-op.

**Why:** The test asserts both the visual removal (`queryByText` absent) and the callback call (`toHaveBeenCalledWith`) with no `await waitFor`, meaning both must be synchronous. Delaying `onDelete` until after the API would break the test.

**Trade-off:** No rollback on API failure for this pattern. Document this in a comment on `handleConfirm`. If rollback is needed in future slices, use a different design: `onDelete` accepts an async API-calling implementation, and the component awaits it before setting `vanished=true`.

---

## `vanished` state bridges the one-render gap before unmount

Setting `vanished=true` in `handleConfirm` causes the card to render `null` immediately. Without it, there would be a visible flash of the card between the user clicking Confirm and the parent receiving `onDelete` and filtering the card from state — one React render cycle's worth of lag.

**How to apply:** Any optimistic-delete component that also notifies a parent to remove it from state should carry a local `vanished` boolean. Set it before calling the parent callback. This avoids the one-frame flicker without requiring a more complex co-ordination mechanism.

---

## Merge conflicts from concurrent type fixes in shared components

Both the main branch (via PR #87) and the 11-E branch fixed the `onOpenNote` 2-arg → 3-arg type mismatch in `ListView.tsx`. This produced a merge conflict during the rebase before merging 11-E. The conflict was straightforward to resolve, but the extra step added friction.

**How to apply:** Before starting a slice, grep for TypeScript errors in shared component types (`onOpenNote`, `onDeleteNote`, etc.). If a type mismatch is visible in the IDE or CI, fix it on main before cutting the slice branch — it is cheaper than resolving a merge conflict mid-slice.
