# CHANGE-33 — naming the leave destination, and the fix that did nothing

**Slice:** CHANGE-33 · PR #444 · deploy #745 · 2026-08-09
**Filed as:** "Copy/UX only — no behaviour change."

## What shipped

The mid-recording leave confirm named only itself — "Still recording —" — while [BUG-54] grew the exits it guards from 2 to 8. It now names the destination: "Still recording — go to Home?", "— sign out?", "— open Standup?".

`RequestLeave` gained a **required** `destination` parameter. Required, not optional, is the load-bearing choice: an optional one lets a future guarded exit reinstate the anonymous banner silently, with no type error. Ten call sites had to name themselves before the code compiled.

## The lesson: a fix that is invisible to the test suite is unverified, not done

The first implementation added `flex-wrap: wrap` + `max-width: 100%` to the confirm so a long note title would push the buttons onto a second line instead of off-screen.

It did nothing. `.leaveConfirm` sits inside `.noteHeaderActions`, itself a flex item of `.noteHeader`. A flex item defaults to `min-width: auto` and so **refuses to shrink below its content**, so `max-width: 100%` resolved against a width that was already content-derived and `flex-wrap` never triggered. The buttons would still have been pushed out of reach.

Nothing could have caught it:

| Gate | Why it stayed green |
| --- | --- |
| vitest / jsdom | applies no CSS at all — layout is unobservable |
| `tsc`, eslint | CSS is not their surface |
| PR CI | runs the above |
| E2E | no journey asserts the banner |

So the whole verification chain was green on a fix that had no effect. Review caught it by reading the flexbox semantics, not by running anything.

**Generalises:** when the mechanism you added is *structurally* unobservable to every automated gate, the green build says nothing about it. Either move the guarantee somewhere the gates can see, or verify the mechanism by hand and say so.

Both were done here. `min-width: 0` fixes the layout, and — the better half — `destinationName()` **clips any user-supplied name to 40 characters**, bounding the *content* rather than relying on layout jsdom cannot see. That part has a test.

## Three more things review found that tests could not

1. **`openNoteDestination` had four branches and zero coverage.** Stubbing the whole function to a constant left the suite green — no test opened a note while recording. Two tests now drive the reachable paths (folder preview → card-list lookup; "+ New Note" → `isNew`).
2. **The `aria-label` and the live region were both untested.** Deleting either was invisible. Assertions now go through `getByRole('alertdialog', { name })`, which puts the label under test on *every* destination rather than in one bolt-on case.
3. **A nested live region.** `role="alertdialog"` inherits `alert`'s implicit `aria-live`/`aria-atomic`, so an explicit `aria-live` on a child element is a region inside a region — announced twice or dropped, depending on the screen reader. The region moved onto the dialog itself; a test now asserts the inner span has **no** `aria-live`, so the regression cannot come back quietly.

## "Copy only" was not a good estimate of the work

The ticket read as a string change. The actual content was:

1. A contract change threaded through 10 call sites.
2. A naming decision per exit — including one that is *not* a place ("sign out") and one deliberately named by the action rather than the landing spot ("close this tab", because where a close lands is a consequence the user did not pick).
3. Fallbacks for every name that can be absent or unbounded.
4. Live-region semantics, because the destination is replaced *while the dialog is open*.

Hawk was ~46% of the slice's spend and every round was load-bearing. A "copy only" label is about the diff's shape, not its risk — the risk here was concentrated in the parts that were not copy.

## Residual

The screen-reader announcement (assertive + atomic + a label that duplicates the visible text) is reasoned from the ARIA spec, not verified against a real screen reader. Behaviour for a *labelled atomic live region* genuinely varies between implementations. Filed as a manual check in [`desktop/MANUAL-VERIFICATION.md`](../../desktop/MANUAL-VERIFICATION.md). It is strictly better than the bare banner either way.

Related: [BUG-54 — guarding every exit](bug54-guarding-every-exit.md).
