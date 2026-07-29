# BUG-54 — Guarding every exit from a recording note

**Shipped:** 2026-07-29 · PR #412 · deploy run 30481183307 (green on re-run) · commit `ddcb172c`

Navigating away from a recording note now asks first on all seven exits. Frontend-only.

## A test written to close a review finding needs the same red-first proof as the fix

This is the lesson of the slice. Over three review rounds I wrote three specs in response to Hawk findings, and **two of them passed against the unfixed code**:

1. The first "declining doesn't fire the side effect" spec drove `handleFolderSelect` — a path that was *already* correct. Hawk caught it: "worse than an absent spec, because it reads as coverage."
2. The replacement drove the right path but asserted on the preview panel's *header*, which renders `folderName` unconditionally and is never cleared — so it showed "Clients" whether the panel was open or shut. Only running it against the pre-fix code exposed this; reading it twice did not.

The project already requires reproduce-before-fix for bugs. The gap was assuming that a spec written *because a reviewer asked for it* is exempt — it isn't. **Run every new spec against the unfixed code and watch it fail for the reason you expect.** An assertion that cannot distinguish the two states is invisible on inspection and permanent once merged.

## The seam, not the call sites

The bug was filed as "a one-line wrap per call site" (three sites). It was not:

- `WorkspaceSwitcher` owns its own `useNavigate`, so a prop from `App` could never reach it → the guard had to be a **context** (`useRequestLeave()`), not a prop.
- Review then found **three more** exits: `submitCreate` (ten lines below the `switchTo` I'd just fixed), **sign-out**, and **move-to-workspace**.

Generalises: when a bug report enumerates call sites, treat the list as a sample. Grep for the *capability* (here, anything that navigates) rather than fixing the named instances — and count the ones your fix's own mechanism can't reach.

## Source state acts on the click; destination state waits for the leave

My first fix moved *all* side effects into the deferred continuation, including `setSidebarOpen(false)`. Wrong on mobile: the sidebar is an overlay with a full-screen scrim, so leaving it open dimmed and blocked the very "Still recording" confirm the guard had just raised — the tap looked like it did nothing.

The rule that fell out: **state belonging to the control you just used (source) settles immediately; state belonging to where you're going (destination) waits.** Closing the sidebar and the switcher popover are source; opening the folder preview and navigating are destination.

## A guard that fires on a no-op is a guard that causes the loss

`openNote` lacked the same-note early return `handleSelectTab` had, so clicking the note you were already on raised the confirm — for a navigation that unmounts nothing. A user who complied would stop a recording **because of the feature built to protect it**. Any guard needs an "is this actually destructive?" check, not just "is this an exit?".

## Awaiting a flush opens an interaction window

Making `handleConfirmedLeave` await the content save (needed so sign-out doesn't 401 the POST against a cleared token) restored the Save button while the promise settled — a second click could navigate twice. Fixed with a `leavingRef` latch. **Any time you insert an `await` into a confirmed user action, ask what the UI now allows during it.**

## Done actions

| Action | Status |
|---|---|
| Guard all seven exits | Done — #412 |
| File the local-mode sign-out residual (transcript commit 401s after the finalise) | Done — [BUG-55] |
| File "name the destination in the confirm" (2 exits → 7) | Done — [CHANGE-33] |
| Record the BUG-38 recurrence + new evidence on this deploy | Done — see the [BUG-38] row |
| Report that BUG-38's own diagnostic can't see this variant (`System.TimeoutException` vs the caught `PlaywrightException`) | Done — recorded on [BUG-38] |

## Deferred, deliberately

- **[BUG-55]** — gating the sign-out continuation on the transcript commit means holding the confirm open for the minutes-long local finalise. Real complexity in the app's most failure-sensitive component; refused to land it unreviewed at the tail of a three-round PR.
- Pressing Stop while the confirm is showing is read as consent and completes the navigation. Deliberate: nothing is left to protect.
- Cosmetic churn in `App.tsx` (indentation, declaration order) — the file already carries a large re-indent diff from the provider wrapper, and more noise makes the next reviewer's job harder.
