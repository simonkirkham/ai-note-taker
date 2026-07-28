# 49-A — Open-note tab bar

**Shipped:** 2026-07-28 · PR #410 · deploy 30402913987 · commit `109c126b`

Frontend-only slice: several notes open at once, one visible, click a tab to switch. No events, projections, endpoints or CDK.

## The lesson worth keeping: "reuse the existing guard" was wrong, and only the test proved it

The phase doc planned the recording protection as *reuse BUG-34's popstate trap; if it doesn't cover the tab click, lift the guard into a callback*. The first branch is the one that reads as obviously right — the trap already exists, it already shows the confirm, and a tab click "navigates away" just like Back does.

It does not cover it. A tab click is a React Router `navigate`, which **pushes**; `popstate` fires only on a **pop**. So the trap is structurally blind to it, and the first version of this slice would have silently killed a live recording on every tab switch — the exact failure BUG-34 was filed for, reintroduced by the feature that reused BUG-34's fix.

What caught it was writing the scenario as a **failing test before the implementation**, per the Breaker convention. Nothing about reading `NoteView.tsx` makes the push/pop distinction jump out; the test simply didn't go red where you'd expect, and that forced the question.

**Generalises to:** when a slice plans to reuse an existing protective mechanism, the *first* test written must be the one that proves the mechanism actually fires on the new path. "It already handles that" is a hypothesis, and event-plumbing hypotheses (which DOM event, which router API, push vs pop, bubble vs capture) are wrong more often than logic hypotheses.

## Guarding a leave is not enough — the guard has to carry the destination

The obvious shape (`guard(): boolean` → caller aborts) produces the wrong UX: the user clicks tab B, confirms "Leave & save", and lands on the workspace *home*, because the existing `handleConfirmedLeave` exits via the deterministic `onExit` route BUG-34 required.

The fix is for the guard to take ownership of the caller's continuation: `requestLeave(proceed)` hands `proceed` to the note, which stashes it and runs it after the user confirms. A *self*-requested leave (Save, back button) still has no `proceed` and still exits via `onExit`, so BUG-34's reason for existing survives intact.

The two follow-on details are the ones that get missed: clear the stashed continuation when the user **cancels**, and clear it when a browser-back **supersedes** a pending tab switch (otherwise "Leave & save" resumes at a tab the user has since navigated away from).

## Derive the tab from the route — don't try to store it

Hawk found that the bar rendered with *no active tab* whenever the URL's note wasn't in the tab set: a cold deep-link, or Back onto a note whose tab had just been closed. The instinct is to add the note to the tab set in a `useEffect` — which is exactly the `react-hooks/set-state-in-effect` trap the CLAUDE.md guardrail names, and which `tsc`/`vitest` would both have greened.

Deriving it in the `useMemo` instead ("the route's note is always shown as a tab, adopted if absent") fixes every entry path at once with no new state and no lint violation. The cost is that adoption is display-only — the adopted tab isn't sticky once you navigate home — which is the right trade until 49-B persists the set.

## A tab bar quietly changes what an E2E fixture does

`ClickNewNoteAsync` creates *and opens* a note, so every journey that builds fixture notes now creates tabs as a side effect. The new journey's exact-count assertions passed only because `AssertNoteVisibleInListAfterReloadAsync` reloads, and an in-memory tab set doesn't survive a reload.

That is a trap primed to fire in **49-B**: persisting tabs makes the reload stop clearing them, and the counts silently become wrong — a deploy-gate red for a slice that didn't touch the journey. Fixed forward by normalising explicitly (`CloseAllTabsExceptAsync`) rather than depending on either behaviour, and recorded in 49-B's build notes.

**Generalises to:** when a slice makes an existing *action* produce new persistent state, audit what the existing test fixtures now leave behind. Same family as the "make pre-existing E2E journeys reload-tolerant in the same slice" guardrail.

## Done actions

| Action | Status |
|---|---|
| File the pre-existing sidebar/Home/folder unguarded-navigation gap as a bug | Done — [BUG-54], high priority |
| Record the fixture-tabs precondition in 49-B's build notes | Done |
| Update the 49-A build notes where the implementation diverged (popstate finding, `nav`/`aria-current` over ARIA tabs) | Done — in the slice PR, not left for Scribe |
| Refresh the roadmap's stale "Bugs — currently open: _(none)_" line | Done — six bugs were open and unlisted |

## Deferred, deliberately

- `handleDelete` still returns to the notes list rather than a neighbouring tab. Changing it touches pre-49 delete behaviour and its specs for marginal gain.
- Two untitled notes share the accessible name "Close Untitled note". Honest naming for a transient state; an id in the label reads worse.
- "Next occurrence" / `/ai` create the note server-side before the leave guard resolves, so declining leaves an unopened note in the list. Accepted over silently killing the recording; revisit if those paths gain their own confirm.
